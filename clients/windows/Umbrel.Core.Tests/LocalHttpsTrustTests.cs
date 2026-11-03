using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using Umbrel.Core;
using Xunit;

namespace Umbrel.Core.Tests;

/// <summary>
/// A TLS server on loopback presents certificates from a stand-in Umbrel CA, and the real
/// pinned client connects to 127.0.0.1, an address none of the certificates name.
/// </summary>
public class LocalHttpsTrustTests
{
	private const string ServerAuth = "1.3.6.1.5.5.7.3.1";
	private const string ClientAuth = "1.3.6.1.5.5.7.3.2";

	private static CancellationToken Ct => TestContext.Current.CancellationToken;

	[Fact]
	public async Task TrustsThePinnedUmbrelAtAnAddressItsCertificateDoesNotName()
	{
		using var ca = CreateCa();
		using var leaf = CreateLeaf(ca, DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(30), ServerAuth);
		Assert.Equal(HttpStatusCode.OK, await RequestAsync(ca, leaf));
	}

	[Fact]
	public async Task RefusesACertificateFromAnotherCa()
	{
		using var ca = CreateCa();
		using var otherCa = CreateCa();
		using var leaf = CreateLeaf(otherCa, DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(30), ServerAuth);
		await Assert.ThrowsAsync<HttpRequestException>(() => RequestAsync(ca, leaf));
	}

	[Fact]
	public async Task RefusesAnExpiredCertificateFromThePinnedCa()
	{
		using var ca = CreateCa();
		using var leaf = CreateLeaf(ca, DateTimeOffset.UtcNow.AddDays(-5), DateTimeOffset.UtcNow.AddDays(-1), ServerAuth);
		await Assert.ThrowsAsync<HttpRequestException>(() => RequestAsync(ca, leaf));
	}

	[Fact]
	public async Task RefusesACertificateNotIssuedForServers()
	{
		using var ca = CreateCa();
		using var leaf = CreateLeaf(ca, DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(30), ClientAuth);
		await Assert.ThrowsAsync<HttpRequestException>(() => RequestAsync(ca, leaf));
	}

	// A reset Umbrel answers with a new CA. That's a changed identity; a certificate from
	// the pinned CA that fails another check isn't.
	[Fact]
	public async Task ReportsACertificateFromAnotherCaAsAChangedIdentity()
	{
		using var ca = CreateCa();
		using var otherCa = CreateCa();
		using var leaf = CreateLeaf(otherCa, DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(30), ServerAuth);
		var error = await Assert.ThrowsAsync<LocalHttpsTransportException>(() => CandidateRequestAsync(ca, leaf));
		Assert.Equal(LocalHttpsTransportErrorKind.IdentityChanged, error.Kind);
	}

	[Fact]
	public async Task ReportsAnExpiredCertificateFromThePinnedCaAsAFailedCheck()
	{
		using var ca = CreateCa();
		using var leaf = CreateLeaf(ca, DateTimeOffset.UtcNow.AddDays(-5), DateTimeOffset.UtcNow.AddDays(-1), ServerAuth);
		var error = await Assert.ThrowsAsync<LocalHttpsTransportException>(() => CandidateRequestAsync(ca, leaf));
		Assert.Equal(LocalHttpsTransportErrorKind.TrustFailed, error.Kind);
	}

	[Fact]
	public async Task ReportsAClientCertificateFromThePinnedCaAsAFailedCheck()
	{
		using var ca = CreateCa();
		using var leaf = CreateLeaf(ca, DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(30), ClientAuth);
		var error = await Assert.ThrowsAsync<LocalHttpsTransportException>(() => CandidateRequestAsync(ca, leaf));
		Assert.Equal(LocalHttpsTransportErrorKind.TrustFailed, error.Kind);
	}

	private static Task<HttpStatusCode> RequestAsync(X509Certificate2 pinned, X509Certificate2 serverCertificate) =>
		ServeAsync(serverCertificate, async port =>
		{
			using var anchor = X509CertificateLoader.LoadCertificate(pinned.RawData);
			using var http = LocalHttpsTransport.CreatePinnedClient(anchor);
			using var response = await http.GetAsync($"https://127.0.0.1:{port}/", Ct);
			return response.StatusCode;
		});

	private static Task<HttpResult> CandidateRequestAsync(X509Certificate2 pinned, X509Certificate2 serverCertificate) =>
		ServeAsync(serverCertificate, port => LocalHttpsTransport.DataAsync(
			LocalHttpsTransport.Request(HttpMethod.Get, new Uri($"https://127.0.0.1:{port}/")),
			pinned.RawData,
			TimeSpan.FromSeconds(10),
			Ct));

	private static async Task<T> ServeAsync<T>(X509Certificate2 serverCertificate, Func<int, Task<T>> request)
	{
		var listener = new TcpListener(IPAddress.Loopback, 0);
		listener.Start();
		var port = ((IPEndPoint)listener.LocalEndpoint).Port;
		var server = Task.Run(async () =>
		{
			try
			{
				using var client = await listener.AcceptTcpClientAsync(Ct);
				await using var tls = new SslStream(client.GetStream());
				await tls.AuthenticateAsServerAsync(new SslServerAuthenticationOptions { ServerCertificate = serverCertificate }, Ct);
				var request = new byte[4096];
				var length = 0;
				while (!Encoding.ASCII.GetString(request, 0, length).Contains("\r\n\r\n", StringComparison.Ordinal))
				{
					var read = await tls.ReadAsync(request.AsMemory(length), Ct);
					if (read == 0) return;
					length += read;
				}
				await tls.WriteAsync(Encoding.ASCII.GetBytes("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok"), Ct);
			}
			catch (Exception)
			{
				// The client refusing the certificate ends the handshake here.
			}
			finally
			{
				listener.Stop();
			}
		}, Ct);

		try
		{
			return await request(port);
		}
		finally
		{
			await server;
		}
	}

	private static X509Certificate2 CreateCa()
	{
		using var key = RSA.Create(2048);
		var request = new CertificateRequest("CN=Umbrel test CA", key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
		request.CertificateExtensions.Add(new X509BasicConstraintsExtension(true, false, 0, true));
		request.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.KeyCertSign | X509KeyUsageFlags.CrlSign, true));
		request.CertificateExtensions.Add(new X509SubjectKeyIdentifierExtension(request.PublicKey, false));
		return request.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-10), DateTimeOffset.UtcNow.AddYears(1));
	}

	// Names only umbrel.local, so 127.0.0.1 never matches.
	private static X509Certificate2 CreateLeaf(X509Certificate2 ca, DateTimeOffset notBefore, DateTimeOffset notAfter, string usage)
	{
		using var key = RSA.Create(2048);
		var request = new CertificateRequest("CN=umbrel.local", key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
		var names = new SubjectAlternativeNameBuilder();
		names.AddDnsName("umbrel.local");
		request.CertificateExtensions.Add(names.Build());
		request.CertificateExtensions.Add(new X509BasicConstraintsExtension(false, false, 0, true));
		request.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.DigitalSignature | X509KeyUsageFlags.KeyEncipherment, true));
		request.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension([new Oid(usage)], false));
		request.CertificateExtensions.Add(X509AuthorityKeyIdentifierExtension.CreateFromCertificate(ca, true, false));
		using var certificate = request.Create(ca, notBefore, notAfter, RandomNumberGenerator.GetBytes(16));
		using var withKey = certificate.CopyWithPrivateKey(key);
		// SslStream needs a server key it can use outside this process's ephemeral key handle.
		return X509CertificateLoader.LoadPkcs12(withKey.Export(X509ContentType.Pfx), null);
	}
}
