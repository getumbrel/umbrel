using System.Net;
using System.Net.Sockets;

namespace Umbrel.Core;

/// <summary>
/// Uses the system resolver so Tailscale's split DNS and MagicDNS search suffix are
/// honored. The caller still decides which resolved address ranges are valid endpoints.
/// </summary>
internal static class IPv4HostResolver
{
	public static async Task<IReadOnlyList<string>> ResolveAsync(
		string host,
		CancellationToken ct,
		TimeSpan? timeout = null)
	{
		using var timeoutCts = new CancellationTokenSource(timeout ?? TimeSpan.FromSeconds(3));
		using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, timeoutCts.Token);
		try
		{
			var addresses = await Dns.GetHostAddressesAsync(host, AddressFamily.InterNetwork, linked.Token)
				.ConfigureAwait(false);
			var seen = new HashSet<string>(StringComparer.Ordinal);
			return addresses
				.Where(address => address.AddressFamily == AddressFamily.InterNetwork)
				.Select(address => address.ToString())
				.Where(seen.Add)
				.ToList();
		}
		catch (OperationCanceledException) when (ct.IsCancellationRequested)
		{
			throw;
		}
		catch (Exception ex) when (ex is SocketException or OperationCanceledException or ArgumentException)
		{
			return [];
		}
	}
}
