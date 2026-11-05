using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Security;
using System.Runtime.Versioning;
using System.Security.Authentication;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

namespace Umbrel.Core;

public enum LocalHttpsTransportErrorKind
{
	NotEnrolled,
	InvalidCertificate,
	IdentityChanged,
	StorageUnavailable,
	TrustFailed,
}

public sealed class LocalHttpsTransportException(LocalHttpsTransportErrorKind kind)
	: Exception(LocalHttpsTransportException.Describe(kind))
{
	public LocalHttpsTransportErrorKind Kind { get; } = kind;

	public static string Describe(LocalHttpsTransportErrorKind kind) => kind switch
	{
		LocalHttpsTransportErrorKind.NotEnrolled => "This Umbrel has not established a secure connection yet",
		LocalHttpsTransportErrorKind.InvalidCertificate => "This Umbrel returned an invalid security certificate",
		LocalHttpsTransportErrorKind.IdentityChanged => "Can’t confirm this is your Umbrel. Its security identity changed",
		LocalHttpsTransportErrorKind.StorageUnavailable => "Secure connection storage is temporarily unavailable",
		_ => "Couldn’t verify this Umbrel’s secure connection",
	};
}

/// <summary>Thrown when a bounded response exceeds its byte budget.</summary>
public sealed class ResponseTooLargeException() : Exception("Response exceeded the allowed size");

/// <summary>Thrown when a per-request timeout elapses (distinct from caller cancellation).</summary>
public sealed class RequestTimeoutException() : Exception("The request timed out");

/// <summary>A completed HTTP exchange with its fully-read, size-bounded body.</summary>
public sealed record HttpResult(int Status, byte[] Body, string? ContentType);

/// <summary>
/// The app trusts one device-local CA per Umbrel. The trust applies only to the
/// HttpClient evaluating that Umbrel; it is never installed in a Windows certificate
/// store. .NET still evaluates the complete chain, validity period and server-auth usage
/// through SslStream's certificate validation, but not the address (see
/// ValidateServerCertificate).
/// </summary>
[SupportedOSPlatform("windows")]
public static class LocalHttpsTransport
{
	private const int BootstrapResponseMaximumBytes = 64 * 1024;
	private const int CandidateResponseMaximumBytes = 64 * 1024;
	// The macOS probe timeout: identification tries a device's routes one after another,
	// so each unreachable one should cost little.
	private static readonly TimeSpan BootstrapTimeout = TimeSpan.FromSeconds(3);
	private static readonly TimeSpan FallbackDiscoveryTimeout = TimeSpan.FromSeconds(2);

	private static readonly LocalHttpsClientPool Pool = new();

	// Plain-HTTP bootstrap: no credentials, no cookies, no redirects, small responses.
	private static readonly HttpClient BootstrapClient = CreatePlainClient(BootstrapTimeout);

	// Legacy discovery asks a handful of untrusted LAN hosts for one tiny JSON value.
	// Keep it separate from enrollment with a hard deadline so trickled responses can
	// never outlive the scan.
	private static readonly HttpClient FallbackDiscoveryClient = CreatePlainClient(FallbackDiscoveryTimeout);

	private static HttpClient CreatePlainClient(TimeSpan timeout)
	{
		var handler = new SocketsHttpHandler
		{
			AllowAutoRedirect = false,
			UseCookies = false,
			// Plaintext bootstrap goes straight to the device, never through a system proxy.
			UseProxy = false,
			ConnectTimeout = timeout,
			PooledConnectionLifetime = TimeSpan.FromMinutes(2),
			AutomaticDecompression = DecompressionMethods.None,
		};
		return new HttpClient(handler, disposeHandler: true) { Timeout = Timeout.InfiniteTimeSpan };
	}

	public static Task<HttpResult> BootstrapDataAsync(HttpRequestMessage request, CancellationToken ct) =>
		SendBoundedAsync(BootstrapClient, request, BootstrapTimeout, BootstrapResponseMaximumBytes, ct);

	public static Task<HttpResult> FallbackDiscoveryDataAsync(
		HttpRequestMessage request,
		int maximumBytes,
		CancellationToken ct) =>
		SendBoundedAsync(FallbackDiscoveryClient, request, FallbackDiscoveryTimeout, maximumBytes, ct);

	/// <summary>Send through the pooled client pinned to the saved Umbrel's CA.</summary>
	public static Task<HttpResult> DataAsync(
		HttpRequestMessage request,
		string deviceId,
		TimeSpan timeout,
		CancellationToken ct) =>
		Pool.DataAsync(request, deviceId, timeout, ct);

	/// <summary>
	/// Candidate anchors remain in memory until the live HTTPS endpoint proves both
	/// possession of the corresponding private key and the same discovery id.
	/// </summary>
	public static async Task<HttpResult> DataAsync(
		HttpRequestMessage request,
		byte[] candidateCertificate,
		TimeSpan timeout,
		CancellationToken ct)
	{
		var host = request.RequestUri?.Host;
		if (string.IsNullOrEmpty(host)) throw new LocalHttpsTransportException(LocalHttpsTransportErrorKind.InvalidCertificate);
		X509Certificate2 anchor;
		try
		{
			anchor = X509CertificateLoader.LoadCertificate(candidateCertificate);
		}
		catch (CryptographicException)
		{
			throw new LocalHttpsTransportException(LocalHttpsTransportErrorKind.InvalidCertificate);
		}
		var refusals = new CertificateRefusals();
		using (anchor)
		using (var client = CreatePinnedClient(anchor, refusals))
		{
			return await ExplainingRefusalAsync(
				refusals,
				() => SendBoundedAsync(client, request, timeout, CandidateResponseMaximumBytes, ct)).ConfigureAwait(false);
		}
	}

	/// <summary>
	/// TLS reports a refused certificate only as a failed handshake. Say why it was refused
	/// when that happened during this request.
	/// </summary>
	internal static async Task<HttpResult> ExplainingRefusalAsync(CertificateRefusals refusals, Func<Task<HttpResult>> send)
	{
		var started = Stopwatch.GetTimestamp();
		try
		{
			return await send().ConfigureAwait(false);
		}
		catch (HttpRequestException error) when (error.InnerException is AuthenticationException &&
			refusals.Since(started) is { } kind)
		{
			throw new LocalHttpsTransportException(kind);
		}
	}

	/// <summary>Decode one PEM certificate to DER, rejecting anything that isn't a certificate.</summary>
	public static byte[] CertificateDataFromPem(string pem)
	{
		var body = pem
			.Replace("-----BEGIN CERTIFICATE-----", "", StringComparison.Ordinal)
			.Replace("-----END CERTIFICATE-----", "", StringComparison.Ordinal);
		var compact = string.Concat(body.Where(c => !char.IsWhiteSpace(c)));
		if (compact.Length == 0) throw new LocalHttpsTransportException(LocalHttpsTransportErrorKind.InvalidCertificate);
		byte[] decoded;
		try
		{
			decoded = Convert.FromBase64String(compact);
			using var certificate = X509CertificateLoader.LoadCertificate(decoded);
			return certificate.RawData;
		}
		catch (Exception ex) when (ex is FormatException or CryptographicException)
		{
			throw new LocalHttpsTransportException(LocalHttpsTransportErrorKind.InvalidCertificate);
		}
	}

	internal static SecretStore.LocalHttpsCaStoreResult Enroll(
		byte[] certificate,
		string deviceId,
		bool replacingExisting = false)
	{
		var result = replacingExisting
			? SecretStore.ReplaceLocalHttpsCa(certificate, deviceId)
			: SecretStore.StoreLocalHttpsCaIfAbsent(certificate, deviceId);
		// Drop every cached client after an explicit claim so subsequent requests can
		// only use the newly selected identity.
		if (replacingExisting && result == SecretStore.LocalHttpsCaStoreResult.Stored) Pool.Remove(deviceId);
		return result;
	}

	internal static void Forget(string deviceId)
	{
		SecretStore.DeleteLocalHttpsCa(deviceId);
		Pool.Remove(deviceId);
	}

	internal static HttpClient CreatePinnedClient(X509Certificate2 anchor, CertificateRefusals? refusals = null)
	{
		// The anchor is copied so the pooled client's lifetime does not depend on the
		// caller's certificate handle.
		var pinnedAnchor = X509CertificateLoader.LoadCertificate(anchor.RawData);
		var handler = new SocketsHttpHandler
		{
			// API requests can carry native access credentials. Never forward them to a
			// redirected origin, even if that origin presents a certificate from the CA.
			AllowAutoRedirect = false,
			UseCookies = false,
			// An Umbrel is on the local network or Tailscale; a system proxy must never relay
			// that traffic or see its addresses.
			UseProxy = false,
			ConnectTimeout = TimeSpan.FromSeconds(10),
			PooledConnectionLifetime = TimeSpan.FromMinutes(5),
			AutomaticDecompression = DecompressionMethods.None,
			SslOptions = new SslClientAuthenticationOptions
			{
				EnabledSslProtocols = SslProtocols.Tls12 | SslProtocols.Tls13,
				// CustomRootTrust makes the enrolled CA the only acceptable root for this
				// client. SslStream adds server-auth usage to the policy and reports chain,
				// date and usage problems as RemoteCertificateChainErrors, and a request host
				// the leaf doesn't name as RemoteCertificateNameMismatch.
				CertificateChainPolicy = new X509ChainPolicy
				{
					TrustMode = X509ChainTrustMode.CustomRootTrust,
					CustomTrustStore = { pinnedAnchor },
					RevocationMode = X509RevocationMode.NoCheck,
					VerificationFlags = X509VerificationFlags.NoFlag,
				},
				RemoteCertificateValidationCallback = (_, certificate, chain, errors) =>
				{
					var trusted = ValidateServerCertificate(pinnedAnchor, certificate, chain, errors);
					if (!trusted) refusals?.Record(RefusalKind(pinnedAnchor, certificate, chain));
					return trusted;
				},
			},
		};
		return new HttpClient(handler, disposeHandler: true) { Timeout = Timeout.InfiniteTimeSpan };
	}

	// The chain handed to the callback was built with the custom-root policy above, so no
	// error but a name mismatch means "issued by the enrolled CA, in date and for servers".
	// The anchor is the Umbrel's own CA, which signs only that Umbrel's server certificate,
	// so the pin alone proves identity. The certificate's names can lag behind the Umbrel's
	// real addresses (a new Tailscale or DHCP address, or Tailscale on umbrelOS from before
	// late June 2026, which never names its 100.x address), so they aren't matched, as in
	// UmbrelKit. The explicit root comparison is defense in depth against a policy that is
	// later relaxed by mistake.
	internal static bool ValidateServerCertificate(
		X509Certificate2 anchor,
		X509Certificate? certificate,
		X509Chain? chain,
		SslPolicyErrors errors)
	{
		if (certificate is null || chain is null) return false;
		if ((errors & ~SslPolicyErrors.RemoteCertificateNameMismatch) != SslPolicyErrors.None) return false;
		if (chain.ChainElements.Count == 0) return false;
		var root = chain.ChainElements[^1].Certificate;
		if (!root.RawData.AsSpan().SequenceEqual(anchor.RawData)) return false;
		return true;
	}

	// A certificate this Umbrel's CA didn't issue is a different identity, as after the
	// Umbrel or its certificate is reset. Anything else is a failed check.
	internal static LocalHttpsTransportErrorKind RefusalKind(
		X509Certificate2 anchor,
		X509Certificate? certificate,
		X509Chain? chain) =>
		certificate is not null && !IsIssuedBy(anchor, certificate, chain)
			? LocalHttpsTransportErrorKind.IdentityChanged
			: LocalHttpsTransportErrorKind.TrustFailed;

	// Whether a refused server's certificate came from this anchor, however else it failed:
	// dates a wrong clock disagrees with, or the wrong usage. The chain is built again with
	// the anchor as its only root and judged by its signatures alone, so it reaches the
	// anchor exactly when the anchor issued the certificate.
	internal static bool IsIssuedBy(X509Certificate2 anchor, X509Certificate certificate, X509Chain? presented)
	{
		using var leaf = X509CertificateLoader.LoadCertificate(certificate.GetRawCertData());
		using var chain = new X509Chain();
		chain.ChainPolicy.TrustMode = X509ChainTrustMode.CustomRootTrust;
		chain.ChainPolicy.CustomTrustStore.Add(anchor);
		chain.ChainPolicy.RevocationMode = X509RevocationMode.NoCheck;
		if (presented is not null)
		{
			foreach (var element in presented.ChainElements) chain.ChainPolicy.ExtraStore.Add(element.Certificate);
		}
		chain.Build(leaf);
		if (chain.ChainElements.Count == 0) return false;
		if (!chain.ChainElements[^1].Certificate.RawData.AsSpan().SequenceEqual(anchor.RawData)) return false;
		const X509ChainStatusFlags notIssued =
			X509ChainStatusFlags.NotSignatureValid | X509ChainStatusFlags.PartialChain | X509ChainStatusFlags.UntrustedRoot;
		return chain.ChainElements.All(element => element.ChainElementStatus.All(status => (status.Status & notIssued) == 0));
	}

	internal static string NormalizeHost(string host) =>
		(host.EndsWith('.') ? host[..^1] : host).ToLowerInvariant();

	/// <summary>
	/// Send with a timeout and a hard byte budget. The body is read from the stream so an
	/// oversized response is abandoned before it is buffered. By default the timeout is a
	/// deadline for the whole exchange; with <paramref name="resetsOnProgress"/> it is an
	/// idle timeout that restarts whenever data arrives.
	/// </summary>
	internal static async Task<HttpResult> SendBoundedAsync(
		HttpClient client,
		HttpRequestMessage request,
		TimeSpan timeout,
		int maximumBytes,
		CancellationToken ct,
		bool resetsOnProgress = false)
	{
		using var timeoutCts = new CancellationTokenSource(timeout);
		using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, timeoutCts.Token);
		try
		{
			using var response = await client
				.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, linked.Token)
				.ConfigureAwait(false);
			if (resetsOnProgress) timeoutCts.CancelAfter(timeout);
			var contentLength = response.Content.Headers.ContentLength;
			if (contentLength is > 0 && contentLength > maximumBytes) throw new ResponseTooLargeException();

			await using var stream = await response.Content.ReadAsStreamAsync(linked.Token).ConfigureAwait(false);
			var buffer = new MemoryStream(contentLength is > 0 ? (int)contentLength : 4096);
			var chunk = new byte[16 * 1024];
			while (true)
			{
				var read = await stream.ReadAsync(chunk, linked.Token).ConfigureAwait(false);
				if (read == 0) break;
				if (buffer.Length + read > maximumBytes) throw new ResponseTooLargeException();
				buffer.Write(chunk, 0, read);
				if (resetsOnProgress) timeoutCts.CancelAfter(timeout);
			}
			return new HttpResult(
				(int)response.StatusCode,
				buffer.ToArray(),
				response.Content.Headers.ContentType?.MediaType);
		}
		catch (OperationCanceledException) when (timeoutCts.IsCancellationRequested && !ct.IsCancellationRequested)
		{
			throw new RequestTimeoutException();
		}
	}

	/// <summary>Build a request that bypasses caches and never carries cookies.</summary>
	internal static HttpRequestMessage Request(HttpMethod method, Uri uri)
	{
		var request = new HttpRequestMessage(method, uri);
		request.Headers.CacheControl = new CacheControlHeaderValue { NoStore = true, NoCache = true };
		return request;
	}
}

/// <summary>
/// Why a pinned client last refused a server's certificate, and when, so a failed request
/// can say whether the Umbrel answered with a different identity. Accepted certificates
/// aren't recorded: a handshake that succeeds on another connection meanwhile mustn't hide
/// this request's refusal.
/// </summary>
internal sealed class CertificateRefusals
{
	private readonly object _gate = new();
	private LocalHttpsTransportErrorKind? _kind;
	private long _at;

	public void Record(LocalHttpsTransportErrorKind kind)
	{
		lock (_gate)
		{
			_kind = kind;
			_at = Stopwatch.GetTimestamp();
		}
	}

	// The refusal recorded since start, if there was one
	public LocalHttpsTransportErrorKind? Since(long start)
	{
		lock (_gate) return _at >= start ? _kind : null;
	}
}

/// <summary>One pinned HttpClient per (device, host), created lazily from the stored CA.</summary>
[SupportedOSPlatform("windows")]
internal sealed class LocalHttpsClientPool
{
	private readonly record struct Key(string DeviceId, string Host);

	private sealed record Entry(HttpClient Client, CertificateRefusals Refusals);

	private readonly object _gate = new();
	private readonly Dictionary<Key, Entry> _entries = new();

	public async Task<HttpResult> DataAsync(
		HttpRequestMessage request,
		string deviceId,
		TimeSpan timeout,
		CancellationToken ct)
	{
		var host = request.RequestUri?.Host;
		if (string.IsNullOrEmpty(host)) throw new LocalHttpsTransportException(LocalHttpsTransportErrorKind.TrustFailed);
		var entry = EntryFor(new Key(deviceId, LocalHttpsTransport.NormalizeHost(host)));
		// Requests to an enrolled Umbrel time out only when data stops arriving, matching
		// the Apple clients' URLSession request timeout, so a wallpaper or app list over a
		// slow Tailscale route isn't cut off mid-transfer. Unpinned bootstrap, candidate,
		// and fallback probes keep a hard deadline.
		return await LocalHttpsTransport.ExplainingRefusalAsync(
			entry.Refusals,
			() => LocalHttpsTransport.SendBoundedAsync(
				entry.Client, request, timeout, maximumBytes: 32 * 1024 * 1024, ct, resetsOnProgress: true))
			.ConfigureAwait(false);
	}

	public void Remove(string deviceId)
	{
		lock (_gate)
		{
			foreach (var key in _entries.Keys.Where(key => key.DeviceId == deviceId).ToList())
			{
				_entries[key].Client.Dispose();
				_entries.Remove(key);
			}
		}
	}

	private Entry EntryFor(Key key)
	{
		lock (_gate)
		{
			if (_entries.TryGetValue(key, out var existing)) return existing;

			byte[] certificateData = SecretStore.ReadLocalHttpsCa(key.DeviceId) switch
			{
				SecretStore.LocalHttpsCaReadResult.Found found => found.Certificate,
				SecretStore.LocalHttpsCaReadResult.Missing =>
					throw new LocalHttpsTransportException(LocalHttpsTransportErrorKind.NotEnrolled),
				_ => throw new LocalHttpsTransportException(LocalHttpsTransportErrorKind.StorageUnavailable),
			};
			X509Certificate2 anchor;
			try
			{
				anchor = X509CertificateLoader.LoadCertificate(certificateData);
			}
			catch (CryptographicException)
			{
				throw new LocalHttpsTransportException(LocalHttpsTransportErrorKind.InvalidCertificate);
			}
			using (anchor)
			{
				var refusals = new CertificateRefusals();
				var entry = new Entry(LocalHttpsTransport.CreatePinnedClient(anchor, refusals), refusals);
				_entries[key] = entry;
				return entry;
			}
		}
	}
}
