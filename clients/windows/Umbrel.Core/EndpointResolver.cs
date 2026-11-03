namespace Umbrel.Core;

public static partial class Umbreld
{
	public sealed record Target
	{
		public string DeviceId { get; }
		public IReadOnlyList<string> Hosts { get; }

		public Target(string deviceId, IEnumerable<string> hosts)
		{
			DeviceId = deviceId;
			var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
			Hosts = hosts.Where(host => host.Length > 0 && seen.Add(host)).ToList();
		}

		public bool Equals(Target? other) =>
			other is not null && DeviceId == other.DeviceId && Hosts.SequenceEqual(other.Hosts);

		public override int GetHashCode() => HashCode.Combine(DeviceId, Hosts.Count);
	}
}

internal sealed class EndpointResolutionException() : Exception("Couldn’t reach this Umbrel");

internal enum EndpointRejectionKind
{
	ProtocolFailure = 1,
	Trust = 2,
	Storage = 3,
}

internal sealed class EndpointRejectionException(EndpointRejectionKind kind, string message) : Exception(message)
{
	public EndpointRejectionKind Kind { get; } = kind;
	public int Priority => (int)Kind;
}

internal abstract record EndpointVerification
{
	public sealed record Verified : EndpointVerification;
	public sealed record Unavailable : EndpointVerification;
	public sealed record Rejected(EndpointRejectionKind Kind, string Message) : EndpointVerification;
}

/// <summary>
/// Picks the first candidate host that proves the saved Umbrel's pinned identity.
/// Tailscale gives native traffic one stable endpoint as the client moves between
/// physical networks, so it gets a short head start; a disconnected tunnel adds at most
/// that delay before a verified local route takes over.
/// </summary>
internal sealed class NativeEndpointResolver(TimeSpan? tailscalePreferenceWindow = null)
{
	public delegate Task<EndpointVerification> Verify(string host, string deviceId, CancellationToken ct);

	private sealed class PreferenceWindowExpiredException : Exception;

	private readonly record struct ResolutionKey(string DeviceId, string Hosts);

	private readonly TimeSpan _tailscalePreferenceWindow = tailscalePreferenceWindow ?? TimeSpan.FromSeconds(1);
	private readonly object _gate = new();
	private readonly Dictionary<string, string> _winners = new();
	private readonly Dictionary<ResolutionKey, Task<string>> _resolutionTasks = new();

	public async Task<string> ResolveAsync(
		Umbreld.Target target,
		Verify verify,
		CancellationToken ct,
		string? excludedHost = null)
	{
		ct.ThrowIfCancellationRequested();
		var candidates = target.Hosts
			.Where(host => !host.Equals(excludedHost ?? "", StringComparison.OrdinalIgnoreCase))
			.ToList();
		if (candidates.Count == 0) throw new EndpointResolutionException();
		var key = new ResolutionKey(
			target.DeviceId,
			string.Join("\n", candidates.Select(host => host.ToLowerInvariant()).Order(StringComparer.Ordinal)));

		Task<string> task;
		var started = false;
		lock (_gate)
		{
			if (_winners.TryGetValue(target.DeviceId, out var winner) &&
				candidates.Any(host => host.Equals(winner, StringComparison.OrdinalIgnoreCase)))
			{
				return winner;
			}
			if (excludedHost is null && _resolutionTasks.TryGetValue(key, out var shared))
			{
				task = shared;
			}
			else
			{
				task = Task.Run(() => FirstPreferredVerifiedAsync(
					target.DeviceId, candidates, _tailscalePreferenceWindow, verify, CancellationToken.None));
				started = true;
				if (excludedHost is null) _resolutionTasks[key] = task;
			}
		}

		// As in the Apple resolver, the caller that started a resolution records its winner
		// and retires the shared task in one step before returning, so a resolve that follows
		// Invalidate can never reuse the finished task and skip re-verification.
		try
		{
			var result = await task.WaitAsync(ct).ConfigureAwait(false);
			ct.ThrowIfCancellationRequested();
			if (started)
			{
				lock (_gate)
				{
					_winners[target.DeviceId] = result;
					Retire(key, task);
				}
			}
			return result;
		}
		catch when (started)
		{
			lock (_gate) Retire(key, task);
			throw;
		}
	}

	private void Retire(ResolutionKey key, Task<string> task)
	{
		if (_resolutionTasks.TryGetValue(key, out var current) && ReferenceEquals(current, task)) _resolutionTasks.Remove(key);
	}

	public void Invalidate(string deviceId, string host)
	{
		lock (_gate)
		{
			if (_winners.TryGetValue(deviceId, out var winner) && winner.Equals(host, StringComparison.OrdinalIgnoreCase))
			{
				_winners.Remove(deviceId);
			}
		}
	}

	/// <summary>A network change can make the cached route obsolete without a request failing first.</summary>
	public void Invalidate(string deviceId)
	{
		lock (_gate) _winners.Remove(deviceId);
	}

	private static async Task<string> FirstPreferredVerifiedAsync(
		string deviceId,
		IReadOnlyList<string> hosts,
		TimeSpan tailscalePreferenceWindow,
		Verify verify,
		CancellationToken ct)
	{
		var tailscaleHosts = hosts.Where(SavedDevice.IsTailscaleAddress).ToList();
		var localHosts = hosts.Where(host => !SavedDevice.IsTailscaleAddress(host)).ToList();
		if (tailscaleHosts.Count == 0 || localHosts.Count == 0)
		{
			return await FirstVerifiedAsync(deviceId, hosts, verify, ct).ConfigureAwait(false);
		}

		try
		{
			return await FirstVerifiedWithinAsync(deviceId, tailscaleHosts, tailscalePreferenceWindow, verify, ct)
				.ConfigureAwait(false);
		}
		catch (PreferenceWindowExpiredException)
		{
			// The tunnel has not failed; it simply did not answer within its preference
			// window. Race it again with local routes so the first verified path wins.
			return await FirstVerifiedAsync(deviceId, hosts, verify, ct).ConfigureAwait(false);
		}
		catch (EndpointRejectionException tailscaleRejection)
		{
			try
			{
				return await FirstVerifiedAsync(deviceId, localHosts, verify, ct).ConfigureAwait(false);
			}
			catch (EndpointRejectionException localRejection)
			{
				throw localRejection.Priority > tailscaleRejection.Priority ? localRejection : tailscaleRejection;
			}
			catch (EndpointResolutionException)
			{
				throw tailscaleRejection;
			}
		}
		catch (EndpointResolutionException)
		{
			return await FirstVerifiedAsync(deviceId, localHosts, verify, ct).ConfigureAwait(false);
		}
	}

	private static async Task<string> FirstVerifiedWithinAsync(
		string deviceId,
		IReadOnlyList<string> hosts,
		TimeSpan window,
		Verify verify,
		CancellationToken ct)
	{
		using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
		var race = FirstVerifiedAsync(deviceId, hosts, verify, cts.Token);
		var timer = Task.Delay(window, cts.Token);
		var first = await Task.WhenAny(race, timer).ConfigureAwait(false);
		if (ReferenceEquals(first, race))
		{
			cts.Cancel();
			return await race.ConfigureAwait(false);
		}
		cts.Cancel();
		try
		{
			await race.ConfigureAwait(false);
		}
		// Only cancellation is swallowed: a rejection that raced the window is still a rejection.
		catch (OperationCanceledException)
		{
		}
		ct.ThrowIfCancellationRequested();
		throw new PreferenceWindowExpiredException();
	}

	private static async Task<string> FirstVerifiedAsync(
		string deviceId,
		IReadOnlyList<string> hosts,
		Verify verify,
		CancellationToken ct)
	{
		using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
		var attempts = hosts.Select(async host =>
		{
			if (cts.Token.IsCancellationRequested) return (host, (EndpointVerification)new EndpointVerification.Unavailable());
			try
			{
				return (host, await verify(host, deviceId, cts.Token).ConfigureAwait(false));
			}
			catch (OperationCanceledException)
			{
				return (host, new EndpointVerification.Unavailable());
			}
		}).ToList();

		EndpointVerification.Rejected? strongest = null;
		while (attempts.Count > 0)
		{
			var finished = await Task.WhenAny(attempts).ConfigureAwait(false);
			attempts.Remove(finished);
			var (host, verification) = await finished.ConfigureAwait(false);
			switch (verification)
			{
				case EndpointVerification.Verified when !cts.Token.IsCancellationRequested:
					cts.Cancel();
					return host;
				case EndpointVerification.Rejected rejected:
					if (strongest is null || (int)rejected.Kind > (int)strongest.Kind) strongest = rejected;
					break;
			}
		}
		ct.ThrowIfCancellationRequested();
		if (strongest is not null) throw new EndpointRejectionException(strongest.Kind, strongest.Message);
		throw new EndpointResolutionException();
	}
}
