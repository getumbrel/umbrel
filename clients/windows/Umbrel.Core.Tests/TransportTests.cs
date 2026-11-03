using System.Net;
using System.Net.Sockets;
using System.Security.Authentication;
using System.Text;
using Umbrel.Core;
using Xunit;

namespace Umbrel.Core.Tests;

/// <summary>Plain HTTP on loopback stands in for an Umbrel so timing and drops are exact.</summary>
public class TransportTests
{
	private static readonly byte[] Headers = Encoding.ASCII.GetBytes("HTTP/1.1 200 OK\r\nContent-Length: 20\r\n\r\n");

	private static CancellationToken Ct => TestContext.Current.CancellationToken;

	private static (int Port, Task Server) ServeOnce(Func<NetworkStream, Socket, Task> respond)
	{
		var listener = new TcpListener(IPAddress.Loopback, 0);
		listener.Start();
		var port = ((IPEndPoint)listener.LocalEndpoint).Port;
		var server = Task.Run(async () =>
		{
			try
			{
				using var client = await listener.AcceptTcpClientAsync(Ct);
				var stream = client.GetStream();
				var request = new byte[4096];
				var length = 0;
				while (!Encoding.ASCII.GetString(request, 0, length).Contains("\r\n\r\n", StringComparison.Ordinal))
				{
					length += await stream.ReadAsync(request.AsMemory(length), Ct);
				}
				await respond(stream, client.Client);
			}
			catch (IOException)
			{
				// The client gave up first; that is what some tests check.
			}
			finally
			{
				listener.Stop();
			}
		}, Ct);
		return (port, server);
	}

	// Twenty bytes, one every 100 ms: two seconds in total but never idle for long.
	private static async Task TrickleAsync(NetworkStream stream, Socket _)
	{
		await stream.WriteAsync(Headers, Ct);
		for (var i = 0; i < 20; i++)
		{
			await Task.Delay(100, Ct);
			await stream.WriteAsync("x"u8.ToArray(), Ct);
		}
	}

	private static async Task<HttpResult> SendAsync(int port, TimeSpan timeout, bool resetsOnProgress)
	{
		using var client = new HttpClient();
		using var request = new HttpRequestMessage(HttpMethod.Get, $"http://127.0.0.1:{port}/");
		return await LocalHttpsTransport.SendBoundedAsync(client, request, timeout, 1024, Ct, resetsOnProgress);
	}

	[Fact]
	public async Task SavedDeviceRequestsTimeOutOnlyWhenDataStops()
	{
		var (port, server) = ServeOnce(TrickleAsync);
		var result = await SendAsync(port, TimeSpan.FromSeconds(1), resetsOnProgress: true);
		Assert.Equal(20, result.Body.Length);
		await server;
	}

	[Fact]
	public async Task ProbesKeepAHardDeadline()
	{
		var (port, server) = ServeOnce(TrickleAsync);
		await Assert.ThrowsAsync<RequestTimeoutException>(() => SendAsync(port, TimeSpan.FromSeconds(1), resetsOnProgress: false));
		await server;
	}

	[Theory]
	[InlineData(false)] // orderly close before the declared length: HttpIOException(ResponseEnded)
	[InlineData(true)] // reset: IOException wrapping a SocketException
	public async Task ABodyCutOffMidTransferIsAConnectivityFailure(bool reset)
	{
		var (port, server) = ServeOnce(async (stream, socket) =>
		{
			await stream.WriteAsync(Headers, Ct);
			await stream.WriteAsync("partial"u8.ToArray(), Ct);
			await Task.Delay(100, Ct);
			if (reset) socket.LingerState = new LingerOption(true, 0);
			socket.Close();
		});
		var error = await Assert.ThrowsAsync<UmbreldException>(() => Umbreld.GuardTransportAsync(
			"127.0.0.1", () => SendAsync(port, TimeSpan.FromSeconds(5), resetsOnProgress: true)));
		Assert.Equal(UmbreldErrorKind.Connectivity, error.Kind);
		await server;
	}

	// .NET reports every failed TLS handshake as SecureConnectionError. A route that drops
	// the connection mid-handshake is unreachable, so another route can be tried; only a
	// rejected certificate is a trust failure.
	[Fact]
	public async Task AResetDuringTheTlsHandshakeIsAConnectivityFailure()
	{
		var listener = new TcpListener(IPAddress.Loopback, 0);
		listener.Start();
		var port = ((IPEndPoint)listener.LocalEndpoint).Port;
		var server = Task.Run(async () =>
		{
			using var client = await listener.AcceptTcpClientAsync(Ct);
			await client.GetStream().ReadAtLeastAsync(new byte[4096], 1, cancellationToken: Ct); // the ClientHello
			client.Client.LingerState = new LingerOption(true, 0);
			client.Client.Close();
			listener.Stop();
		}, Ct);
		using var http = new HttpClient();
		using var request = new HttpRequestMessage(HttpMethod.Get, $"https://127.0.0.1:{port}/");
		var error = await Assert.ThrowsAsync<UmbreldException>(() => Umbreld.GuardTransportAsync(
			"127.0.0.1",
			() => LocalHttpsTransport.SendBoundedAsync(http, request, TimeSpan.FromSeconds(5), 1024, Ct, resetsOnProgress: true)));
		Assert.Equal(UmbreldErrorKind.Connectivity, error.Kind);
		await server;
	}

	[Fact]
	public async Task ARejectedCertificateIsATrustFailure()
	{
		// The shape .NET throws when certificate validation fails (SslStream, ConnectHelper).
		var rejected = new HttpRequestException(
			HttpRequestError.SecureConnectionError, "The SSL connection could not be established", new AuthenticationException());
		var error = await Assert.ThrowsAsync<UmbreldException>(() => Umbreld.GuardTransportAsync(
			"127.0.0.1", () => Task.FromException<HttpResult>(rejected)));
		Assert.Equal(UmbreldErrorKind.Trust, error.Kind);
	}
}
