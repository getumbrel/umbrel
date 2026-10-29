using System.Net;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Runtime.Versioning;
using System.Security.Authentication;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Umbrel.Core;

public enum UmbreldErrorKind
{
	Server,
	Connectivity,
	Trust,
	Storage,
	ProtocolFailure,
}

public sealed class UmbreldException(int status, string message, UmbreldErrorKind kind = UmbreldErrorKind.Server)
	: Exception(message)
{
	public int Status { get; } = status;
	public UmbreldErrorKind Kind { get; } = kind;
	public bool IsAuthError => Status == 401;
	public bool IsConnectivityFailure => Kind == UmbreldErrorKind.Connectivity;
	public bool RequiresTwoFactorAuthentication => Message == "Missing 2FA code";
}

public enum ManualDiscoveryErrorKind
{
	InvalidAddress,
	NoDeviceFound,
}

public sealed class ManualDiscoveryException(ManualDiscoveryErrorKind kind)
	: Exception(ManualDiscoveryException.Describe(kind))
{
	public ManualDiscoveryErrorKind Kind { get; } = kind;

	public static string Describe(ManualDiscoveryErrorKind kind) => kind switch
	{
		ManualDiscoveryErrorKind.InvalidAddress =>
			"Enter a local or Tailscale IP address, .local hostname, or Tailscale MagicDNS name.",
		_ => "Couldn’t find an Umbrel at this address. Make sure it’s online and reachable.",
	};
}

/// <summary>A host that might be an Umbrel, found via the _umbrel._tcp DNS-SD advertisement.</summary>
public sealed record Candidate(
	string Host,
	IReadOnlyList<string> Addresses,
	string Name,
	string? Id = null,
	string? Model = null,
	bool? Onboarded = null)
{
	public Candidate(string host, string name) : this(host, [], name)
	{
	}
}

/// <summary>
/// A discovery candidate whose local CA validated an HTTPS system.discoveryInfo response
/// with the same id. DNS-SD contributes only connection locations and a cosmetic name;
/// it is never an identity authority.
/// </summary>
public sealed record IdentifiedDevice
{
	public required string Host { get; init; } // the exact hostname or IP that answered the identity probe
	public required string DiscoveryHost { get; init; }
	public required IReadOnlyList<string> Addresses { get; init; }
	public required string Name { get; init; } // untrusted DNS-SD instance name, display fallback only
	public required string Id { get; init; }
	public required string Model { get; init; }
	public required bool Onboarded { get; init; }
	// Kept inside Umbrel.Core so passive scans can hand the exact verified candidate
	// anchor to an explicit claim without exposing trust material to app UI code.
	internal byte[]? CandidateCaCertificate { get; init; }

	public Umbreld.DiscoveryInfo DiscoveryInfo => new(Id, Model, Onboarded);
}

/// <summary>
/// Minimal hand-written client for the umbreld tRPC endpoints the apps use. Wire shapes
/// are plain records rather than generated from the router. Calls are stateless
/// statics taking (host, session) because the apps talk to several devices at once.
///
/// umbreld runs tRPC without a transformer, so envelopes are plain JSON:
///   success: {"result": {"data": value}}
///   error:   {"error": {"message": "..."}}
/// </summary>
[SupportedOSPlatform("windows")]
public static partial class Umbreld
{
	// The stable device credential is stored in the secret store and sent only to the
	// access exchange. Normal API calls carry the short-lived access credential.
	public sealed record Session(
		string DeviceId,
		string AccountId,
		string AccessToken,
		long AccessExpiresAt,
		string DeviceToken)
	{
		/// <summary>Access tokens rotate, but these fields identify one server-issued login.</summary>
		public bool BelongsToSameLogin(Session other) =>
			DeviceId == other.DeviceId && AccountId == other.AccountId && DeviceToken == other.DeviceToken;
	}

	public sealed record DiscoveryInfo(string Id, string Device, bool Onboarded);

	public sealed record Wallpaper(string Id, string BrandColorHsl);

	public sealed record Account(string UserId, string Name, Wallpaper Wallpaper, string? AvatarUrl = null);

	public sealed record UserInfo(
		string UserId,
		string Name,
		string Role,
		string HomePath,
		bool SambaEnabled,
		string SambaUsername,
		Wallpaper Wallpaper);

	public sealed record Share(string Name, string Path, string Sharename);

	public sealed record UpdateRequiredDevice(string Host);

	public abstract record ManualDiscoveryResult
	{
		public sealed record Device(IdentifiedDevice Value) : ManualDiscoveryResult;
		public sealed record UpdateRequired(UpdateRequiredDevice Value) : ManualDiscoveryResult;
	}

	private static readonly TimeSpan ProbeTimeout = TimeSpan.FromSeconds(3);
	private static readonly TimeSpan FallbackProbeTimeout = TimeSpan.FromSeconds(2);
	private static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(10);
	private const int FallbackResponseMaximumBytes = 16 * 1024;
	private static readonly SessionCoordinator Coordinator = new();
	private static readonly NativeEndpointResolver EndpointResolver = new();

	// Decode like Swift's Decodable on the Apple clients: a field the record doesn't mark
	// optional (with a default) must be present and non-null, so a bad response fails as
	// "unexpected response" instead of handing null credentials or hosts to callers.
	internal static readonly JsonSerializerOptions JsonOptions = new()
	{
		PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
		PropertyNameCaseInsensitive = true,
		DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
		RespectNullableAnnotations = true,
		RespectRequiredConstructorParameters = true,
		Converters = { new NonNullListConverterFactory() },
	};

	/// <summary>
	/// System.Text.Json can't see the nullability of list elements, so a null inside a
	/// wire array would otherwise decode as a null record or string. No umbreld list has
	/// optional elements.
	/// </summary>
	private sealed class NonNullListConverterFactory : JsonConverterFactory
	{
		public override bool CanConvert(Type typeToConvert) =>
			typeToConvert.IsGenericType && typeToConvert.GetGenericTypeDefinition() == typeof(IReadOnlyList<>);

		public override JsonConverter CreateConverter(Type typeToConvert, JsonSerializerOptions options) =>
			(JsonConverter)Activator.CreateInstance(
				typeof(NonNullListConverter<>).MakeGenericType(typeToConvert.GetGenericArguments()[0]))!;
	}

	private sealed class NonNullListConverter<T> : JsonConverter<IReadOnlyList<T>>
	{
		public override IReadOnlyList<T> Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
		{
			if (reader.TokenType != JsonTokenType.StartArray) throw new JsonException("Expected an array");
			var items = new List<T>();
			while (reader.Read() && reader.TokenType != JsonTokenType.EndArray)
			{
				if (reader.TokenType == JsonTokenType.Null) throw new JsonException("Unexpected null array element");
				items.Add(JsonSerializer.Deserialize<T>(ref reader, options)!);
			}
			return items;
		}

		public override void Write(Utf8JsonWriter writer, IReadOnlyList<T> value, JsonSerializerOptions options)
		{
			writer.WriteStartArray();
			foreach (var item in value) JsonSerializer.Serialize(writer, item, options);
			writer.WriteEndArray();
		}
	}

	// ── Identity (the discovery oracle) ──
	// system.discoveryInfo is the authority for a device's id, model, and onboarding
	// state. DNS-SD only supplies candidate locations and display hints. The HTTP
	// bootstrap carries no credentials and is accepted only after the advertised CA
	// proves the same identity over HTTPS.

	private sealed record LocalHttpsIdentity(string Id, string CaCertificate);

	private sealed record VerifiedLocalHttpsCandidate(DiscoveryInfo DiscoveryInfo, byte[] Certificate);

	internal sealed record IdentityProbeResult(DiscoveryInfo DiscoveryInfo, byte[]? CandidateCertificate);

	internal abstract record SavedIdentityRecoveryDecision
	{
		public sealed record AlreadyEnrolled : SavedIdentityRecoveryDecision;
		public sealed record Claim(string Host) : SavedIdentityRecoveryDecision;
	}

	/// <summary>
	/// Passive discovery is deliberately read-only. HTTP carries only a candidate public
	/// CA and discovery id; the candidate stays in memory long enough to prove the same
	/// id over HTTPS, but opening the app never persists it.
	/// </summary>
	public static async Task<DiscoveryInfo?> IdentifyAsync(
		string host,
		string? expectedDeviceId,
		CancellationToken ct)
	{
		try
		{
			return (await VerifiedLocalHttpsIdentityAsync(host, expectedDeviceId, ct).ConfigureAwait(false)).DiscoveryInfo;
		}
		catch (OperationCanceledException) when (ct.IsCancellationRequested)
		{
			throw;
		}
		catch (Exception)
		{
			return null;
		}
	}

	private static async Task<IdentityProbeResult> VerifiedLocalHttpsIdentityAsync(
		string host,
		string? expectedDeviceId,
		CancellationToken ct)
	{
		// A saved Umbrel must validate directly against its existing pin.
		if (expectedDeviceId is not null)
		{
			switch (SecretStore.ReadLocalHttpsCa(expectedDeviceId))
			{
				case SecretStore.LocalHttpsCaReadResult.Found:
					var identity = await DiscoveryInfoOverHttpsAsync(host, expectedDeviceId, ct).ConfigureAwait(false);
					if (identity.Id != expectedDeviceId)
					{
						throw new LocalHttpsTransportException(LocalHttpsTransportErrorKind.IdentityChanged);
					}
					return new IdentityProbeResult(identity, null);
				case SecretStore.LocalHttpsCaReadResult.Missing:
					throw new LocalHttpsTransportException(LocalHttpsTransportErrorKind.NotEnrolled);
				default:
					throw new LocalHttpsTransportException(LocalHttpsTransportErrorKind.StorageUnavailable);
			}
		}

		var candidate = await VerifiedFirstUseCandidateAsync(host, expectedDeviceId, ct).ConfigureAwait(false);
		return new IdentityProbeResult(candidate.DiscoveryInfo, candidate.Certificate);
	}

	private static async Task<VerifiedLocalHttpsCandidate> VerifiedFirstUseCandidateAsync(
		string host,
		string? expectedDeviceId,
		CancellationToken ct)
	{
		var bootstrap = await LocalHttpsIdentityAsync(host, ct).ConfigureAwait(false);
		if (expectedDeviceId is not null && bootstrap.Id != expectedDeviceId)
		{
			throw new LocalHttpsTransportException(LocalHttpsTransportErrorKind.IdentityChanged);
		}
		var candidate = LocalHttpsTransport.CertificateDataFromPem(bootstrap.CaCertificate);
		var identity = await DiscoveryInfoOverHttpsAsync(host, candidate, ct).ConfigureAwait(false);
		if (identity.Id != bootstrap.Id) throw new LocalHttpsTransportException(LocalHttpsTransportErrorKind.IdentityChanged);
		return new VerifiedLocalHttpsCandidate(identity, candidate);
	}

	/// <summary>
	/// Explicitly selecting an unsaved card establishes first-use trust. Re-verify the
	/// exact endpoint with the candidate anchor held from that scan, then replace a pin
	/// left by an earlier claim that never reached sign-in. Saved devices never call this API.
	/// </summary>
	public static async Task<DiscoveryInfo> ClaimLocalHttpsIdentityAsync(IdentifiedDevice device, CancellationToken ct)
	{
		var certificate = device.CandidateCaCertificate
			?? throw new LocalHttpsTransportException(LocalHttpsTransportErrorKind.IdentityChanged);
		var identity = await DiscoveryInfoOverHttpsAsync(device.Host, certificate, ct).ConfigureAwait(false);
		if (identity.Id != device.Id) throw new LocalHttpsTransportException(LocalHttpsTransportErrorKind.IdentityChanged);
		return LocalHttpsTransport.Enroll(certificate, device.Id, replacingExisting: true) switch
		{
			SecretStore.LocalHttpsCaStoreResult.Stored or SecretStore.LocalHttpsCaStoreResult.AlreadyMatches => identity,
			SecretStore.LocalHttpsCaStoreResult.Unavailable =>
				throw new LocalHttpsTransportException(LocalHttpsTransportErrorKind.StorageUnavailable),
			_ => throw new LocalHttpsTransportException(LocalHttpsTransportErrorKind.IdentityChanged),
		};
	}

	/// <summary>
	/// A restored config can outlive both device-local secrets. Recover only from an
	/// explicit sign-in, only when neither a pin nor a session exists, and only through
	/// the saved primary LAN endpoint. Returns true when a pin was (re)established.
	/// </summary>
	public static async Task<bool> PrepareSavedDeviceForSignInAsync(Target target, CancellationToken ct)
	{
		var decision = DecideSavedIdentityRecovery(
			target,
			SecretStore.ReadLocalHttpsCa(target.DeviceId),
			SecretStore.ReadSession(target.DeviceId));
		if (decision is not SavedIdentityRecoveryDecision.Claim claim) return false;

		var candidate = await VerifiedFirstUseCandidateAsync(claim.Host, target.DeviceId, ct).ConfigureAwait(false);

		// Re-check after the network operation. If another explicit flow installed a pin,
		// validate with that pin; never replace it from this recovery path.
		var recheck = DecideSavedIdentityRecovery(
			target,
			SecretStore.ReadLocalHttpsCa(target.DeviceId),
			SecretStore.ReadSession(target.DeviceId));
		if (recheck is SavedIdentityRecoveryDecision.AlreadyEnrolled)
		{
			var identity = await DiscoveryInfoOverHttpsAsync(claim.Host, target.DeviceId, ct).ConfigureAwait(false);
			if (identity.Id != target.DeviceId)
			{
				throw new LocalHttpsTransportException(LocalHttpsTransportErrorKind.IdentityChanged);
			}
			return true;
		}

		return LocalHttpsTransport.Enroll(candidate.Certificate, target.DeviceId) switch
		{
			SecretStore.LocalHttpsCaStoreResult.Stored or SecretStore.LocalHttpsCaStoreResult.AlreadyMatches => true,
			SecretStore.LocalHttpsCaStoreResult.Unavailable =>
				throw new LocalHttpsTransportException(LocalHttpsTransportErrorKind.StorageUnavailable),
			_ => throw new LocalHttpsTransportException(LocalHttpsTransportErrorKind.IdentityChanged),
		};
	}

	internal static SavedIdentityRecoveryDecision DecideSavedIdentityRecovery(
		Target target,
		SecretStore.LocalHttpsCaReadResult caRead,
		SecretStore.SessionReadResult sessionRead)
	{
		switch (caRead)
		{
			case SecretStore.LocalHttpsCaReadResult.Found:
				return new SavedIdentityRecoveryDecision.AlreadyEnrolled();
			case SecretStore.LocalHttpsCaReadResult.Unavailable:
				throw new LocalHttpsTransportException(LocalHttpsTransportErrorKind.StorageUnavailable);
		}

		switch (sessionRead)
		{
			case SecretStore.SessionReadResult.Missing:
				break;
			case SecretStore.SessionReadResult.Unavailable:
				throw new LocalHttpsTransportException(LocalHttpsTransportErrorKind.StorageUnavailable);
			default:
				throw new LocalHttpsTransportException(LocalHttpsTransportErrorKind.NotEnrolled);
		}

		var host = target.Hosts.FirstOrDefault();
		if (host is null || !SavedDevice.IsValidLocalEndpointHost(host) || SavedDevice.IsTailscaleAddress(host))
		{
			throw new LocalHttpsTransportException(LocalHttpsTransportErrorKind.TrustFailed);
		}
		return new SavedIdentityRecoveryDecision.Claim(host);
	}

	private static async Task<LocalHttpsIdentity> LocalHttpsIdentityAsync(string host, CancellationToken ct)
	{
		var request = LocalHttpsTransport.Request(HttpMethod.Get, PlainUri(host, "/trpc/system.localHttpsIdentity"));
		var result = await GuardTransportAsync(
			host,
			() => LocalHttpsTransport.BootstrapDataAsync(request, ct)).ConfigureAwait(false);
		return DecodeEnvelope<LocalHttpsIdentity>(result, "system.localHttpsIdentity");
	}

	private static async Task<DiscoveryInfo> DiscoveryInfoOverHttpsAsync(string host, string deviceId, CancellationToken ct)
	{
		var request = LocalHttpsTransport.Request(HttpMethod.Get, HttpsUri(host, "/trpc/system.discoveryInfo"));
		var result = await GuardTransportAsync(
			host,
			() => LocalHttpsTransport.DataAsync(request, deviceId, ProbeTimeout, ct)).ConfigureAwait(false);
		return DecodeEnvelope<DiscoveryInfo>(result, "system.discoveryInfo");
	}

	private static async Task<DiscoveryInfo> DiscoveryInfoOverHttpsAsync(
		string host,
		byte[] candidateCertificate,
		CancellationToken ct)
	{
		var request = LocalHttpsTransport.Request(HttpMethod.Get, HttpsUri(host, "/trpc/system.discoveryInfo"));
		var result = await GuardTransportAsync(
			host,
			() => LocalHttpsTransport.DataAsync(request, candidateCertificate, ProbeTimeout, ct)).ConfigureAwait(false);
		return DecodeEnvelope<DiscoveryInfo>(result, "system.discoveryInfo");
	}

	/// <summary>
	/// A read-only availability check for addresses already learned from a saved Umbrel.
	/// Every route, including a 100.64/10 address, must validate against the existing CA
	/// pin. An address class alone does not prove that packets traversed Tailscale.
	/// </summary>
	public static async Task<bool> IsKnownEndpointAvailableAsync(string host, string deviceId, CancellationToken ct)
	{
		try
		{
			if (SecretStore.ReadLocalHttpsCa(deviceId) is not SecretStore.LocalHttpsCaReadResult.Found) return false;
			var identity = await DiscoveryInfoOverHttpsAsync(host, deviceId, ct).ConfigureAwait(false);
			return identity.Id == deviceId;
		}
		catch (OperationCanceledException) when (ct.IsCancellationRequested)
		{
			throw;
		}
		catch (Exception)
		{
			return false;
		}
	}

	internal delegate Task<IdentityProbeResult?> IdentityProbe(string host, string? expectedDeviceId, CancellationToken ct);

	// The TXT id is only an optimization. A candidate claiming a saved id is probed with
	// that pin immediately; if an unhinted candidate later returns a saved id, repeat the
	// probe with the saved pin before admitting it.
	internal static async Task<IdentifiedDevice?> IdentifyCandidateAsync(
		Candidate candidate,
		IReadOnlySet<string> knownDeviceIds,
		CancellationToken ct,
		string? requiredDeviceId = null,
		bool allowsTailscaleHost = false,
		IdentityProbe? probe = null)
	{
		Candidate accepted;
		if (allowsTailscaleHost)
		{
			accepted = candidate;
		}
		else
		{
			var local = LocalDiscoveryCandidate(candidate);
			if (local is null) return null;
			accepted = local;
		}
		probe ??= async (host, expectedDeviceId, token) =>
		{
			try
			{
				return await VerifiedLocalHttpsIdentityAsync(host, expectedDeviceId, token).ConfigureAwait(false);
			}
			catch (OperationCanceledException) when (token.IsCancellationRequested)
			{
				throw;
			}
			catch (Exception)
			{
				return null;
			}
		};

		var hintedDeviceId = requiredDeviceId
			?? (accepted.Id is not null && knownDeviceIds.Contains(accepted.Id) ? accepted.Id : null);
		var attempted = new HashSet<string>(StringComparer.Ordinal);
		foreach (var host in new[] { accepted.Host }.Concat(accepted.Addresses))
		{
			// Only a literal IPv4 address or .local name is ever probed, so a candidate
			// can't aim the plaintext bootstrap at an internet name or splice extra URL
			// syntax into the request.
			if (!SavedDevice.IsValidLocalEndpointHost(host) || !attempted.Add(host)) continue;
			ct.ThrowIfCancellationRequested();
			var verified = await probe(host, hintedDeviceId, ct).ConfigureAwait(false);
			if (verified is null) continue;
			var identity = verified.DiscoveryInfo;
			if (hintedDeviceId is not null)
			{
				if (identity.Id != hintedDeviceId) continue;
			}
			else if (knownDeviceIds.Contains(identity.Id))
			{
				// The authoritative response identified a saved device whose TXT hint did
				// not. Discard the first-use result unless its stored pin also validates.
				var pinned = await probe(host, identity.Id, ct).ConfigureAwait(false);
				if (pinned is null || pinned.DiscoveryInfo.Id != identity.Id) continue;
				verified = pinned;
				identity = pinned.DiscoveryInfo;
			}
			return new IdentifiedDevice
			{
				Host = host,
				DiscoveryHost = accepted.Host,
				Addresses = accepted.Addresses,
				Name = accepted.Name,
				Id = identity.Id,
				Model = identity.Device,
				Onboarded = identity.Onboarded,
				CandidateCaCertificate = verified.CandidateCertificate,
			};
		}
		return null;
	}

	/// <summary>
	/// DNS-SD is an unauthenticated source of local connection candidates: any LAN peer
	/// can advertise any target. Accept only literal IPv4 addresses and .local names, and
	/// never let it introduce a Tailscale-range endpoint; those come only from the
	/// authenticated system.getIpAddresses response after sign-in.
	/// </summary>
	internal static Candidate? LocalDiscoveryCandidate(Candidate candidate)
	{
		if (!IsLocalDiscoveryHost(candidate.Host)) return null;
		return candidate with { Addresses = candidate.Addresses.Where(IsLocalDiscoveryHost).ToList() };
	}

	private static bool IsLocalDiscoveryHost(string host) =>
		SavedDevice.IsValidLocalEndpointHost(host) && !SavedDevice.IsTailscaleAddress(host);

	/// <summary>
	/// Probe a discovery snapshot concurrently and collapse duplicate advertisements by
	/// the authoritative id returned from each device.
	/// </summary>
	public static async Task<IReadOnlyList<IdentifiedDevice>> IdentifyAsync(
		IReadOnlyList<Candidate> candidates,
		IReadOnlySet<string> knownDeviceIds,
		CancellationToken ct)
	{
		var results = await Task.WhenAll(
			candidates.Select(candidate => IdentifyCandidateAsync(candidate, knownDeviceIds, ct))).ConfigureAwait(false);
		ct.ThrowIfCancellationRequested();
		var byId = new Dictionary<string, IdentifiedDevice>(StringComparer.Ordinal);
		foreach (var device in results.OfType<IdentifiedDevice>().OrderBy(device => device.Host, StringComparer.Ordinal))
		{
			byId.TryAdd(device.Id, device);
		}
		return byId.Values.OrderBy(device => device.Host, StringComparer.Ordinal).ToList();
	}

	internal abstract record ReidentifyAnchor
	{
		public sealed record Candidate(byte[] Certificate) : ReidentifyAnchor;
		public sealed record Pinned(string DeviceId) : ReidentifyAnchor;
	}

	internal delegate Task<DiscoveryInfo?> ReidentifyProbe(string host, ReidentifyAnchor anchor, CancellationToken ct);

	/// <summary>
	/// An Umbrel's DNS-SD advertisement doesn't change when it finishes setup in a
	/// browser, so a client waiting on setup has to ask again. This re-asks the exact
	/// endpoint over the anchor its scan already verified, so it adds no trust of its own,
	/// and returns the record with its current state. Null when it doesn't answer as the
	/// same Umbrel.
	/// </summary>
	public static Task<IdentifiedDevice?> ReidentifyAsync(IdentifiedDevice device, CancellationToken ct) =>
		ReidentifyAsync(device, async (host, anchor, token) =>
		{
			try
			{
				return anchor switch
				{
					ReidentifyAnchor.Candidate candidate =>
						await DiscoveryInfoOverHttpsAsync(host, candidate.Certificate, token).ConfigureAwait(false),
					ReidentifyAnchor.Pinned pinned =>
						await DiscoveryInfoOverHttpsAsync(host, pinned.DeviceId, token).ConfigureAwait(false),
					_ => null,
				};
			}
			catch (OperationCanceledException) when (token.IsCancellationRequested)
			{
				throw;
			}
			catch (Exception)
			{
				return null;
			}
		}, ct);

	internal static async Task<IdentifiedDevice?> ReidentifyAsync(
		IdentifiedDevice device,
		ReidentifyProbe probe,
		CancellationToken ct)
	{
		// A first-use scan holds its candidate anchor; a claimed device was verified with
		// its stored pin and has none.
		ReidentifyAnchor anchor = device.CandidateCaCertificate is { } certificate
			? new ReidentifyAnchor.Candidate(certificate)
			: new ReidentifyAnchor.Pinned(device.Id);
		var identity = await probe(device.Host, anchor, ct).ConfigureAwait(false);
		if (identity is null || identity.Id != device.Id) return null;
		return device with { Model = identity.Device, Onboarded = identity.Onboarded };
	}

	// ── Manual discovery ──

	internal abstract record ManualDiscoveryHost(string Value)
	{
		public sealed record Direct(string Host) : ManualDiscoveryHost(Host);
		public sealed record UnqualifiedHostname(string Host) : ManualDiscoveryHost(Host);
		public sealed record TailscaleDns(string Host) : ManualDiscoveryHost(Host);
	}

	/// <summary>
	/// Manual discovery is an explicit user action, so unlike passive DNS-SD it may probe
	/// a Tailscale endpoint. A plain HTTP(S) root URL is normalized to its host. Short
	/// hostnames may resolve to a LAN or Tailscale address, while full MagicDNS names
	/// resolve only to a literal Tailscale address because Umbrel's pinned certificate
	/// covers its interface IP, not a user-controlled tailnet name.
	/// </summary>
	public static async Task<ManualDiscoveryResult> DiscoverManuallyAsync(
		string input,
		IReadOnlySet<string> knownDeviceIds,
		CancellationToken ct)
	{
		var parsedHost = ManualDiscoveryHostKind(input) ?? throw new ManualDiscoveryException(ManualDiscoveryErrorKind.InvalidAddress);
		Candidate candidate;
		switch (parsedHost)
		{
			case ManualDiscoveryHost.Direct:
				candidate = ManualDiscoveryCandidate(input)
					?? throw new ManualDiscoveryException(ManualDiscoveryErrorKind.InvalidAddress);
				break;
			default:
				var addresses = await IPv4HostResolver.ResolveAsync(parsedHost.Value, ct).ConfigureAwait(false);
				ct.ThrowIfCancellationRequested();
				if (addresses.Count == 0) throw new ManualDiscoveryException(ManualDiscoveryErrorKind.NoDeviceFound);
				candidate = ManualDiscoveryCandidate(input, addresses)
					?? throw new ManualDiscoveryException(ManualDiscoveryErrorKind.NoDeviceFound);
				break;
		}
		var device = await IdentifyCandidateAsync(candidate, knownDeviceIds, ct, allowsTailscaleHost: true)
			.ConfigureAwait(false);
		if (device is not null) return new ManualDiscoveryResult.Device(device);
		ct.ThrowIfCancellationRequested();
		var updateRequired = await ProbeLegacyOnlyHostAsync(candidate.Host, ct).ConfigureAwait(false);
		if (updateRequired is not null) return new ManualDiscoveryResult.UpdateRequired(updateRequired);
		ct.ThrowIfCancellationRequested();
		throw new ManualDiscoveryException(ManualDiscoveryErrorKind.NoDeviceFound);
	}

	internal static Candidate? ManualDiscoveryCandidate(string input, IReadOnlyList<string>? resolvedIPv4Addresses = null)
	{
		var parsedHost = ManualDiscoveryHostKind(input);
		return parsedHost switch
		{
			ManualDiscoveryHost.Direct direct => new Candidate(direct.Host, direct.Host),
			ManualDiscoveryHost.UnqualifiedHostname unqualified => ResolvedManualDiscoveryCandidate(
				unqualified.Host, resolvedIPv4Addresses ?? [], SavedDevice.IsSupportedManualIPv4Address),
			ManualDiscoveryHost.TailscaleDns tailscale => ResolvedManualDiscoveryCandidate(
				tailscale.Host, resolvedIPv4Addresses ?? [], SavedDevice.IsTailscaleAddress),
			_ => null,
		};
	}

	private static Candidate? ResolvedManualDiscoveryCandidate(
		string hostname,
		IReadOnlyList<string> addresses,
		Func<string, bool> accepts)
	{
		var seen = new HashSet<string>(StringComparer.Ordinal);
		var accepted = addresses.Where(address => accepts(address) && seen.Add(address)).ToList();
		if (accepted.Count == 0) return null;
		return new Candidate(accepted[0], accepted.Skip(1).ToList(), hostname);
	}

	internal static string? ManualDiscoveryHostValue(string input) => ManualDiscoveryHostKind(input)?.Value;

	internal static ManualDiscoveryHost? ManualDiscoveryHostKind(string input)
	{
		var host = NormalizedManualDiscoveryHost(input);
		if (host is null) return null;
		if (host.EndsWith('.')) host = host[..^1];
		if (host.Length == 0) return null;
		if (SavedDevice.IsIPv4Address(host))
		{
			return SavedDevice.IsSupportedManualIPv4Address(host) ? new ManualDiscoveryHost.Direct(host) : null;
		}
		if (SavedDevice.IsBonjourHostname(host)) return new ManualDiscoveryHost.Direct(host);
		if (!SavedDevice.IsDnsHostname(host)) return null;
		var labels = host.Split('.');
		if (labels.Length == 1) return new ManualDiscoveryHost.UnqualifiedHostname(host);
		return host.EndsWith(".ts.net", StringComparison.Ordinal) ? new ManualDiscoveryHost.TailscaleDns(host) : null;
	}

	// Split the URL by hand instead of using System.Uri, which canonicalizes hosts such as
	// 192.168.001.010 (to 192.168.1.8) or 192.168.1 (to 192.168.0.1) and accepts
	// backslashes. The host must reach the strict checks above exactly as typed, the way
	// URLComponents hands it over on the Apple clients. Only a bare origin is accepted:
	// no user info, port, query, fragment, or path other than "/".
	private static string? NormalizedManualDiscoveryHost(string input)
	{
		var value = input.Trim();
		var lowercased = value.ToLowerInvariant();
		string remainder;
		if (lowercased.StartsWith("http://", StringComparison.Ordinal)) remainder = lowercased["http://".Length..];
		else if (lowercased.StartsWith("https://", StringComparison.Ordinal)) remainder = lowercased["https://".Length..];
		else return lowercased;

		if (remainder.IndexOfAny(['?', '#']) >= 0) return null;
		var slash = remainder.IndexOf('/');
		if (slash >= 0 && slash != remainder.Length - 1) return null;
		var host = slash >= 0 ? remainder[..slash] : remainder;
		if (host.IndexOfAny(['@', ':']) >= 0) return null;
		return host;
	}

	// ── Fallback discovery ──
	// Older umbrelOS releases predate the _umbrel._tcp advertisement. Probe only a small
	// set of default hostnames in parallel; a custom hostname outside this list remains
	// intentionally undiscoverable rather than turning onboarding into a subnet scanner.

	internal static readonly string[] FallbackDiscoveryHosts =
	[
		"umbrel.local",
		"umbrel-2.local",
		"umbrel-3.local",
		"umbrel-4.local",
		"umbrel-5.local",
		"umbrel-home.local",
		"umbrel-pro.local",
	];

	/// <summary>
	/// Runs beside normal discovery and reports hosts that answer system.version as
	/// umbrelOS but return 404 for system.localHttpsIdentity (see ProbeLegacyOnlyHostAsync).
	/// These plaintext responses never create trust, store state, or enable
	/// authentication; they are an update hint only.
	/// </summary>
	public static async Task<IReadOnlyList<UpdateRequiredDevice>> DiscoverFallbackHostsAsync(CancellationToken ct)
	{
		var probes = await Task.WhenAll(FallbackDiscoveryHosts.Select(host => ProbeLegacyOnlyHostAsync(host, ct)))
			.ConfigureAwait(false);
		ct.ThrowIfCancellationRequested();
		return probes.OfType<UpdateRequiredDevice>().OrderBy(device => device.Host, StringComparer.Ordinal).ToList();
	}

	private sealed record SystemVersion(string Version, string Name);

	// A default name such as umbrel.local is often an alias that a current Umbrel also
	// answers to, sometimes only over a flaky IPv6 link-local route, so neither hostname
	// matching nor a failed identity probe proves a host is old. Report an update only
	// on positive evidence: the host answers the public version endpoint as umbrelOS and
	// rejects system.localHttpsIdentity as an unknown procedure (HTTP 404), which every
	// release that supports the native apps serves. A timeout or any other answer is
	// treated as unknown and produces no hint.
	private static async Task<UpdateRequiredDevice?> ProbeLegacyOnlyHostAsync(string host, CancellationToken ct)
	{
		var device = await ProbeFallbackHostAsync(host, ct).ConfigureAwait(false);
		if (device is null) return null;
		return await LacksNativeIdentityEndpointAsync(host, ct).ConfigureAwait(false) ? device : null;
	}

	private static async Task<bool> LacksNativeIdentityEndpointAsync(string host, CancellationToken ct)
	{
		try
		{
			var request = LocalHttpsTransport.Request(HttpMethod.Get, PlainUri(host, "/trpc/system.localHttpsIdentity"));
			var result = await LocalHttpsTransport
				.FallbackDiscoveryDataAsync(request, FallbackResponseMaximumBytes, ct)
				.ConfigureAwait(false);
			return result.Status == 404;
		}
		catch (OperationCanceledException) when (ct.IsCancellationRequested)
		{
			throw;
		}
		catch (Exception)
		{
			return false;
		}
	}

	private static async Task<UpdateRequiredDevice?> ProbeFallbackHostAsync(string host, CancellationToken ct)
	{
		if (ct.IsCancellationRequested) return null;
		try
		{
			await SystemVersionAsync(host, ct).ConfigureAwait(false);
		}
		catch (OperationCanceledException) when (ct.IsCancellationRequested)
		{
			throw;
		}
		catch (Exception)
		{
			return null;
		}
		return ct.IsCancellationRequested ? null : new UpdateRequiredDevice(host);
	}

	private static async Task SystemVersionAsync(string host, CancellationToken ct)
	{
		var request = LocalHttpsTransport.Request(HttpMethod.Get, PlainUri(host, "/trpc/system.version"));
		var result = await LocalHttpsTransport
			.FallbackDiscoveryDataAsync(request, FallbackResponseMaximumBytes, ct)
			.ConfigureAwait(false);
		ValidateFallbackSystemVersion(result);
	}

	// system.version has returned both fields since umbrelOS 1.0. Requiring its stable
	// product name avoids mistaking an unrelated service for an old Umbrel.
	internal static void ValidateFallbackSystemVersion(HttpResult result)
	{
		var response = DecodeEnvelope<SystemVersion>(result, "system.version");
		if (!response.Name.StartsWith("umbrelOS ", StringComparison.Ordinal) ||
			response.Version.Length == 0 ||
			Encoding.UTF8.GetByteCount(response.Version) > 64)
		{
			throw new UmbreldException(result.Status, "system.version: not an umbrelOS response");
		}
	}

	// ── Avatars ──

	public static Task<byte[]> AccountAvatarDataAsync(Target target, string path, CancellationToken ct)
	{
		if (!IsValidAccountAvatarPath(path))
		{
			throw new UmbreldException(0, "Invalid account avatar path", UmbreldErrorKind.ProtocolFailure);
		}
		return WithResolvedHostAsync(target, ReplayPolicy.Safe, ct, async host =>
		{
			var request = LocalHttpsTransport.Request(HttpMethod.Get, HttpsUri(host, path));
			request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("image/webp"));
			var result = await GuardTransportAsync(
				host,
				() => LocalHttpsTransport.DataAsync(request, target.DeviceId, RequestTimeout, ct),
				protocolFailureMessage: "Couldn’t load the account avatar").ConfigureAwait(false);
			if (result.Status is < 200 or >= 300 ||
				!string.Equals(result.ContentType, "image/webp", StringComparison.OrdinalIgnoreCase) ||
				result.Body.Length > 4 * 1024 * 1024)
			{
				throw new UmbreldException(0, "Couldn’t load the account avatar", UmbreldErrorKind.ProtocolFailure);
			}
			return result.Body;
		});
	}

	/// <summary>
	/// Only accept the exact same-origin route emitted by umbreld. Reject absolute or
	/// scheme-relative URLs, queries, fragments, and path traversal before combining
	/// server-provided presentation data with a verified Umbrel host.
	/// </summary>
	internal static bool IsValidAccountAvatarPath(string path)
	{
		var segments = path.Split('/');
		if (segments.Length != 6) return false;
		if (segments[0].Length != 0 || segments[1] != "api" || segments[2] != "accounts" || segments[4] != "avatar") return false;
		if (!IsValidAccountIdSegment(segments[3])) return false;
		var filename = segments[5];
		if (filename.Length != 69 || !filename.EndsWith(".webp", StringComparison.Ordinal)) return false;
		return filename[..64].All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f');
	}

	private static bool IsValidAccountIdSegment(string segment)
	{
		if (segment.Length == 0 || !char.IsAsciiLetterOrDigit(segment[0]) || !char.IsAsciiLetterOrDigit(segment[^1])) return false;
		var previousWasHyphen = false;
		foreach (var c in segment)
		{
			if (c == '-')
			{
				if (previousWasHyphen) return false;
				previousWasHyphen = true;
			}
			else
			{
				if (!char.IsAsciiLetterOrDigit(c)) return false;
				previousWasHyphen = false;
			}
		}
		return true;
	}

	// ── Endpoints ──

	/// <summary>Public by design: presentation metadata only, never account credentials.</summary>
	public static Task<IReadOnlyList<Account>> ListAccountsAsync(string host, string deviceId, CancellationToken ct) =>
		QueryAsync<IReadOnlyList<Account>>(host, "user.listAccounts", ct, deviceId: deviceId);

	public static Task<IReadOnlyList<Account>> ListAccountsAsync(Target target, CancellationToken ct) =>
		WithResolvedHostAsync(target, ReplayPolicy.Safe, ct, host => ListAccountsAsync(host, target.DeviceId, ct));

	/// <summary>Native apps receive a revocable device grant instead of a browser session.</summary>
	public static async Task<Session> LoginAsync(
		string host,
		string deviceId,
		string userId,
		string password,
		string? totpToken,
		CancellationToken ct)
	{
		var body = JsonSerializer.SerializeToUtf8Bytes(
			new NativeLoginInput(userId, password, totpToken, NativeClientInfo.Current), JsonOptions);
		var result = await RequestRawAsync(host, "user.loginNative", HttpMethod.Post, deviceId, null, body, RequestTimeout, ct)
			.ConfigureAwait(false);
		var native = DecodeEnvelope<NativeSessionResponse>(result, "user.loginNative");
		return native.ToSession(deviceId);
	}

	public static Task<Session> LoginAsync(
		Target target,
		string userId,
		string password,
		string? totpToken,
		CancellationToken ct) =>
		WithResolvedHostAsync(target, ReplayPolicy.Never, ct,
			host => LoginAsync(host, target.DeviceId, userId, password, totpToken, ct));

	/// <summary>Renew access ahead of expiry; the health check calls this each cycle.</summary>
	public static Task<Session> RenewSessionAsync(string host, Session session, CancellationToken ct) =>
		Coordinator.SessionAsync(host, session, ct);

	public static Task<Session> RenewSessionAsync(Target target, Session session, CancellationToken ct) =>
		WithResolvedHostAsync(target, ReplayPolicy.Safe, ct, host => RenewSessionAsync(host, session, ct));

	public static async Task LogoutAsync(string host, Session session, CancellationToken ct)
	{
		var body = JsonSerializer.SerializeToUtf8Bytes(new EmptyInput(), JsonOptions);
		var active = session;
		var result = await PerformRequestRawAsync(
			host, "user.logout", HttpMethod.Post, active.DeviceId, active.AccessToken, body, RequestTimeout, ct)
			.ConfigureAwait(false);
		if (result.Status == 401)
		{
			// A caller may remove the local secret before this best-effort request.
			// Refresh from the captured device credential without storing anything, so
			// delayed cleanup can never overwrite a subsequent sign-in.
			active = await RefreshSessionDirectAsync(host, active, ct).ConfigureAwait(false);
			result = await PerformRequestRawAsync(
				host, "user.logout", HttpMethod.Post, active.DeviceId, active.AccessToken, body, RequestTimeout, ct)
				.ConfigureAwait(false);
		}
		_ = DecodeEnvelope<bool>(result, "user.logout");
	}

	public static Task LogoutAsync(Target target, Session session, CancellationToken ct) =>
		WithResolvedHostAsync(target, ReplayPolicy.Never, ct, async host =>
		{
			await LogoutAsync(host, session, ct).ConfigureAwait(false);
			return true;
		});

	/// <summary>Signing out keeps the enrolled CA. Removing the Umbrel discards first-use trust.</summary>
	public static void ForgetLocalHttpsIdentity(string deviceId) => LocalHttpsTransport.Forget(deviceId);

	public static Task<UserInfo> UserAsync(string host, Session session, CancellationToken ct) =>
		QueryAsync<UserInfo>(host, "user.get", ct, session: session);

	public static Task<UserInfo> UserAsync(Target target, Session session, CancellationToken ct) =>
		WithResolvedHostAsync(target, ReplayPolicy.Safe, ct, host => UserAsync(host, session, ct));

	public static Task<IReadOnlyList<string>> IpAddressesAsync(string host, Session session, CancellationToken ct) =>
		QueryAsync<IReadOnlyList<string>>(host, "system.getIpAddresses", ct, session: session);

	public static Task<IReadOnlyList<string>> IpAddressesAsync(Target target, Session session, CancellationToken ct) =>
		WithResolvedHostAsync(target, ReplayPolicy.Safe, ct, host => IpAddressesAsync(host, session, ct));

	public static Task<IReadOnlyList<Share>> SharesAsync(string host, Session session, CancellationToken ct) =>
		QueryAsync<IReadOnlyList<Share>>(host, "files.shares", ct, session: session);

	public static Task<IReadOnlyList<Share>> SharesAsync(Target target, Session session, CancellationToken ct) =>
		WithResolvedHostAsync(target, ReplayPolicy.Safe, ct, host => SharesAsync(host, session, ct));

	public static Task<string> SharePasswordAsync(string host, Session session, CancellationToken ct) =>
		QueryAsync<string>(host, "files.sharePassword", ct, session: session);

	public static Task<string> SharePasswordAsync(Target target, Session session, CancellationToken ct) =>
		WithResolvedHostAsync(target, ReplayPolicy.Safe, ct, host => SharePasswordAsync(host, session, ct));

	public static async Task AddShareAsync(string host, Session session, string path, CancellationToken ct) =>
		_ = await MutateAsync<JsonElement>(host, "files.addShare", new AddShareInput(path), session, ct).ConfigureAwait(false);

	public static Task AddShareAsync(Target target, Session session, string path, CancellationToken ct) =>
		WithResolvedHostAsync(target, ReplayPolicy.Never, ct, async host =>
		{
			await AddShareAsync(host, session, path, ct).ConfigureAwait(false);
			return true;
		});



	// ── Plumbing ──

	private sealed record EmptyInput;

	private sealed record NativeLoginInput(
		string UserId,
		string Password,
		string? TotpToken,
		NativeClientInfo Client);

	private sealed record NativeRefreshInput(string DeviceToken, NativeClientInfo Client);

	private sealed record AddShareInput(string Path);

	private sealed record NativeSessionResponse(string AccountId, string AccessToken, long AccessExpiresAt, string DeviceToken)
	{
		public Session ToSession(string deviceId) => new(deviceId, AccountId, AccessToken, AccessExpiresAt, DeviceToken);
	}

	private sealed record NativeAccessResponse(string AccessToken, long AccessExpiresAt);

	private sealed class Envelope<T>
	{
		public sealed class ErrorBody
		{
			public string? Message { get; set; }
		}

		public JsonElement? Result { get; set; }
		public ErrorBody? Error { get; set; }
	}

	/// <summary>
	/// Returns an origin only after that host proves the saved Umbrel's pinned HTTPS
	/// identity. No password, session token, or other credential is sent by this step.
	/// </summary>
	public static Task<string> ResolvedHostAsync(Target target, CancellationToken ct) =>
		SecretStore.ReadLocalHttpsCa(target.DeviceId) switch
		{
			SecretStore.LocalHttpsCaReadResult.Found => ResolvePinnedHostAsync(target, ct),
			SecretStore.LocalHttpsCaReadResult.Missing => throw TransportError(LocalHttpsTransportErrorKind.NotEnrolled),
			_ => throw new UmbreldException(0,
				LocalHttpsTransportException.Describe(LocalHttpsTransportErrorKind.StorageUnavailable),
				UmbreldErrorKind.Storage),
		};

	/// <summary>A network change does not establish whether an Umbrel is reachable; forget
	/// the cached winner so the next request re-verifies every known endpoint.</summary>
	public static void InvalidateResolvedHost(Target target) => EndpointResolver.Invalidate(target.DeviceId);

	private static async Task<string> ResolvePinnedHostAsync(Target target, CancellationToken ct, string? excludedHost = null)
	{
		try
		{
			return await EndpointResolver.ResolveAsync(target, VerifyEndpointAsync, ct, excludedHost).ConfigureAwait(false);
		}
		catch (OperationCanceledException) when (ct.IsCancellationRequested)
		{
			throw;
		}
		catch (EndpointRejectionException rejection)
		{
			throw EndpointError(rejection);
		}
		catch (Exception)
		{
			throw new UmbreldException(0, "Could not reach this Umbrel", UmbreldErrorKind.Connectivity);
		}
	}

	private static async Task<EndpointVerification> VerifyEndpointAsync(string host, string expectedDeviceId, CancellationToken ct)
	{
		try
		{
			// Treat every endpoint as an untrusted route. The device's pinned CA, not the
			// shape of its address, proves where native credentials may be sent.
			var identity = (await VerifiedLocalHttpsIdentityAsync(host, expectedDeviceId, ct).ConfigureAwait(false)).DiscoveryInfo;
			return identity.Id == expectedDeviceId
				? new EndpointVerification.Verified()
				: new EndpointVerification.Rejected(EndpointRejectionKind.Trust,
					LocalHttpsTransportException.Describe(LocalHttpsTransportErrorKind.IdentityChanged));
		}
		catch (OperationCanceledException)
		{
			return new EndpointVerification.Unavailable();
		}
		catch (LocalHttpsTransportException error)
		{
			return error.Kind == LocalHttpsTransportErrorKind.StorageUnavailable
				? new EndpointVerification.Rejected(EndpointRejectionKind.Storage, error.Message)
				: new EndpointVerification.Rejected(EndpointRejectionKind.Trust, error.Message);
		}
		catch (UmbreldException error) when (error.IsConnectivityFailure)
		{
			return new EndpointVerification.Unavailable();
		}
		catch (UmbreldException error) when (error.Kind == UmbreldErrorKind.Trust)
		{
			return new EndpointVerification.Rejected(EndpointRejectionKind.Trust, error.Message);
		}
		catch (Exception error)
		{
			return new EndpointVerification.Rejected(EndpointRejectionKind.ProtocolFailure, error.Message);
		}
	}

	private static UmbreldException EndpointError(EndpointRejectionException rejection) => rejection.Kind switch
	{
		EndpointRejectionKind.Trust => new UmbreldException(0, rejection.Message, UmbreldErrorKind.Trust),
		EndpointRejectionKind.Storage => new UmbreldException(0, rejection.Message, UmbreldErrorKind.Storage),
		_ => new UmbreldException(0, rejection.Message, UmbreldErrorKind.ProtocolFailure),
	};

	private enum ReplayPolicy
	{
		Safe,
		Never,
	}

	private static async Task<T> WithResolvedHostAsync<T>(
		Target target,
		ReplayPolicy replay,
		CancellationToken ct,
		Func<string, Task<T>> operation)
	{
		var host = await ResolvedHostAsync(target, ct).ConfigureAwait(false);
		try
		{
			return await operation(host).ConfigureAwait(false);
		}
		catch (UmbreldException error) when (error.IsConnectivityFailure)
		{
			EndpointResolver.Invalidate(target.DeviceId, host);
			if (replay != ReplayPolicy.Safe) throw;
			string alternate;
			try
			{
				alternate = await ResolvePinnedHostAsync(target, ct, excludedHost: host).ConfigureAwait(false);
			}
			catch (OperationCanceledException) when (ct.IsCancellationRequested)
			{
				throw;
			}
			catch (UmbreldException resolutionError) when (!resolutionError.IsConnectivityFailure)
			{
				throw;
			}
			catch (Exception)
			{
				throw error;
			}
			try
			{
				return await operation(alternate).ConfigureAwait(false);
			}
			catch (UmbreldException alternateError) when (alternateError.IsConnectivityFailure)
			{
				EndpointResolver.Invalidate(target.DeviceId, alternate);
				throw;
			}
		}
	}

	/// <summary>
	/// Serializes access-token refreshes per login. refreshNativeAccess invalidates the
	/// previous access token immediately, so concurrent requests must share one refresh
	/// and retry a 401 exactly once after re-reading the stored session. Storage and the
	/// refresh call are parameters so tests can drive the interleavings without DPAPI or
	/// a server.
	/// </summary>
	internal sealed class SessionCoordinator(
		Func<string, SecretStore.SessionReadResult> readSession,
		Func<Session, Session, bool> replaceSession,
		Action<Session> deleteSession,
		Func<string, Session, Task<Session>> refresh)
	{
		private const long RefreshLeewayMs = 60_000;
		private readonly object _gate = new();
		private readonly Dictionary<(string DeviceId, string AccountId, string DeviceToken), Task<Session>> _refreshTasks = new();

		public SessionCoordinator()
			: this(
				SecretStore.ReadSession,
				SecretStore.ReplaceSession,
				SecretStore.DeleteSession,
				(host, session) => RefreshSessionDirectAsync(host, session, CancellationToken.None))
		{
		}

		public async Task<Session> SessionAsync(
			string host,
			Session supplied,
			CancellationToken ct,
			bool forceRefresh = false,
			string? rejectedAccessToken = null)
		{
			Task<Session> refreshTask;
			lock (_gate)
			{
				// Read and register under one lock. A read taken before the lock could predate
				// a refresh that has since stored its token and finished; acting on it would
				// start a second refresh that revokes the token the first one handed out.
				var stored = readSession(supplied.DeviceId);
				var current = stored.Session;
				if (current is null || !current.BelongsToSameLogin(supplied))
				{
					throw new UmbreldException(401, "This account is no longer signed in");
				}
				// Another request may already have replaced the rejected credential while this
				// one waited; reuse that result instead of refreshing twice.
				if (rejectedAccessToken is not null && current.AccessToken != rejectedAccessToken) return current;
				var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
				if (!forceRefresh && current.AccessExpiresAt > now + RefreshLeewayMs) return current;
				// Refreshing replaces the active access credential, so do not do it while the
				// result cannot be stored durably.
				if (stored is SecretStore.SessionReadResult.Unavailable)
				{
					throw new UmbreldException(0, "Session storage is temporarily unavailable", UmbreldErrorKind.Storage);
				}

				var identity = (current.DeviceId, current.AccountId, current.DeviceToken);
				if (!_refreshTasks.TryGetValue(identity, out refreshTask!))
				{
					var snapshot = current;
					refreshTask = Task.Run(async () =>
					{
						try
						{
							var refreshed = await refresh(host, snapshot).ConfigureAwait(false);
							if (!replaceSession(refreshed, snapshot))
							{
								throw new UmbreldException(0, "Couldn’t save the renewed session", UmbreldErrorKind.Storage);
							}
							return refreshed;
						}
						catch (UmbreldException error) when (error.IsAuthError)
						{
							deleteSession(snapshot);
							throw;
						}
						finally
						{
							// Runs after the store, so the next caller to take the lock reads
							// the renewed token instead of refreshing again.
							lock (_gate) _refreshTasks.Remove(identity);
						}
					});
					_refreshTasks[identity] = refreshTask;
				}
			}
			return await refreshTask.WaitAsync(ct).ConfigureAwait(false);
		}
	}

	private static Task<T> QueryAsync<T>(
		string host,
		string path,
		CancellationToken ct,
		string? deviceId = null,
		Session? session = null) =>
		RequestAsync<T>(host, path, HttpMethod.Get, deviceId, session, null, RequestTimeout, ct);

	private static Task<T> MutateAsync<T>(
		string host,
		string path,
		object input,
		Session? session,
		CancellationToken ct) =>
		RequestAsync<T>(host, path, HttpMethod.Post, null, session,
			JsonSerializer.SerializeToUtf8Bytes(input, input.GetType(), JsonOptions), RequestTimeout, ct);

	private static async Task<T> RequestAsync<T>(
		string host,
		string path,
		HttpMethod method,
		string? deviceId,
		Session? session,
		byte[]? body,
		TimeSpan timeout,
		CancellationToken ct)
	{
		var result = await RequestRawAsync(host, path, method, deviceId, session, body, timeout, ct).ConfigureAwait(false);
		return DecodeEnvelope<T>(result, path);
	}

	private static async Task<Session> RefreshSessionDirectAsync(string host, Session session, CancellationToken ct)
	{
		var body = JsonSerializer.SerializeToUtf8Bytes(
			new NativeRefreshInput(session.DeviceToken, NativeClientInfo.Current), JsonOptions);
		var result = await PerformRequestRawAsync(
			host, "user.refreshNativeAccess", HttpMethod.Post, session.DeviceId, null, body, RequestTimeout, ct)
			.ConfigureAwait(false);
		var access = DecodeEnvelope<NativeAccessResponse>(result, "user.refreshNativeAccess");
		return session with { AccessToken = access.AccessToken, AccessExpiresAt = access.AccessExpiresAt };
	}

	private static async Task<HttpResult> RequestRawAsync(
		string host,
		string path,
		HttpMethod method,
		string? deviceId,
		Session? session,
		byte[]? body,
		TimeSpan timeout,
		CancellationToken ct)
	{
		if (session is null)
		{
			if (deviceId is null) throw new UmbreldException(0, "Missing Umbrel identity for secure request");
			return await PerformRequestRawAsync(host, path, method, deviceId, null, body, timeout, ct).ConfigureAwait(false);
		}
		if (deviceId is not null && deviceId != session.DeviceId)
		{
			throw new UmbreldException(0, "Umbrel identity does not match this session");
		}

		var current = await Coordinator.SessionAsync(host, session, ct).ConfigureAwait(false);
		var first = await PerformRequestRawAsync(
			host, path, method, current.DeviceId, current.AccessToken, body, timeout, ct).ConfigureAwait(false);
		if (first.Status != 401) return first;

		var refreshed = await Coordinator
			.SessionAsync(host, current, ct, forceRefresh: true, rejectedAccessToken: current.AccessToken)
			.ConfigureAwait(false);
		return await PerformRequestRawAsync(
			host, path, method, refreshed.DeviceId, refreshed.AccessToken, body, timeout, ct).ConfigureAwait(false);
	}

	private static Task<HttpResult> PerformRequestRawAsync(
		string host,
		string path,
		HttpMethod method,
		string deviceId,
		string? accessToken,
		byte[]? body,
		TimeSpan timeout,
		CancellationToken ct)
	{
		var request = LocalHttpsTransport.Request(method, HttpsUri(host, "/trpc/" + path));
		if (accessToken is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
		if (body is not null)
		{
			request.Content = new ByteArrayContent(body);
			request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
		}
		return GuardTransportAsync(host, () => LocalHttpsTransport.DataAsync(request, deviceId, timeout, ct));
	}

	private static Uri HttpsUri(string host, string pathAndQuery)
	{
		if (!Uri.TryCreate($"https://{host}{pathAndQuery}", UriKind.Absolute, out var uri))
		{
			throw new UmbreldException(0, $"Invalid host: {host}");
		}
		return uri;
	}

	private static Uri PlainUri(string host, string pathAndQuery)
	{
		if (!Uri.TryCreate($"http://{host}{pathAndQuery}", UriKind.Absolute, out var uri))
		{
			throw new UmbreldException(0, $"Invalid host: {host}");
		}
		return uri;
	}

	/// <summary>Map transport failures onto the kit's error vocabulary.</summary>
	internal static async Task<HttpResult> GuardTransportAsync(
		string host,
		Func<Task<HttpResult>> send,
		string? protocolFailureMessage = null)
	{
		try
		{
			return await send().ConfigureAwait(false);
		}
		catch (UmbreldException)
		{
			throw;
		}
		catch (OperationCanceledException)
		{
			throw;
		}
		catch (LocalHttpsTransportException error)
		{
			throw TransportError(error.Kind);
		}
		catch (RequestTimeoutException)
		{
			throw new UmbreldException(0, $"Could not reach {host}", UmbreldErrorKind.Connectivity);
		}
		catch (HttpRequestException error) when (IsServerTrustError(error))
		{
			throw new UmbreldException(0,
				LocalHttpsTransportException.Describe(LocalHttpsTransportErrorKind.TrustFailed), UmbreldErrorKind.Trust);
		}
		catch (HttpRequestException error) when (IsConnectivityError(error))
		{
			throw new UmbreldException(0, $"Could not reach {host}", UmbreldErrorKind.Connectivity);
		}
		catch (IOException error) when (IsConnectionLost(error))
		{
			// The route dropped while the body was streaming. Like a lost connection on the
			// Apple clients, this is a connectivity failure, so replay-safe requests can
			// fail over to another verified route.
			throw new UmbreldException(0, $"Could not reach {host}", UmbreldErrorKind.Connectivity);
		}
		catch (Exception)
		{
			throw new UmbreldException(0,
				protocolFailureMessage ?? $"Could not reach {host}", UmbreldErrorKind.ProtocolFailure);
		}
	}

	private static UmbreldException TransportError(LocalHttpsTransportErrorKind kind) =>
		new(0, LocalHttpsTransportException.Describe(kind),
			kind == LocalHttpsTransportErrorKind.StorageUnavailable ? UmbreldErrorKind.Storage : UmbreldErrorKind.Trust);

	private static bool IsConnectivityError(HttpRequestException error) =>
		error.HttpRequestError is HttpRequestError.NameResolutionError or HttpRequestError.ConnectionError
		|| error.InnerException is SocketException or TimeoutException or IOException;

	// Reading the body surfaces a reset as a plain IOException and an early close as
	// HttpIOException(ResponseEnded). A malformed response stays a protocol failure.
	private static bool IsConnectionLost(IOException error) =>
		error is not HttpIOException http ||
		http.HttpRequestError is HttpRequestError.ResponseEnded or HttpRequestError.ConnectionError;

	// Every failed TLS handshake is a SecureConnectionError. A rejected certificate surfaces
	// as an AuthenticationException; a connection dropped mid-handshake is an IOException
	// and stays a connectivity failure, so another route can be tried.
	private static bool IsServerTrustError(HttpRequestException error) =>
		error.InnerException is AuthenticationException;

	// A null result is a protocol failure: no endpoint the app uses declares an optional result.
	internal static T DecodeEnvelope<T>(HttpResult result, string path)
	{
		Envelope<T>? envelope = null;
		try
		{
			envelope = JsonSerializer.Deserialize<Envelope<T>>(result.Body, JsonOptions);
		}
		catch (JsonException)
		{
		}

		if (result.Status is < 200 or >= 300)
		{
			// Surface the tRPC error message (e.g. "Invalid password") when present
			var message = envelope?.Error?.Message ?? $"{path} failed ({result.Status})";
			throw new UmbreldException(result.Status, message);
		}
		if (envelope?.Result is not { } resultElement || resultElement.ValueKind != JsonValueKind.Object)
		{
			throw new UmbreldException(result.Status, $"{path}: unexpected response");
		}
		if (!resultElement.TryGetProperty("data", out var data) || data.ValueKind == JsonValueKind.Undefined)
		{
			throw new UmbreldException(result.Status, $"{path}: unexpected response");
		}
		if (data.ValueKind == JsonValueKind.Null)
		{
			throw new UmbreldException(result.Status, $"{path}: unexpected response");
		}
		try
		{
			return data.Deserialize<T>(JsonOptions)
				?? throw new UmbreldException(result.Status, $"{path}: unexpected response");
		}
		catch (JsonException)
		{
			throw new UmbreldException(result.Status, $"{path}: unexpected response");
		}
	}
}
