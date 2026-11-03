using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;
using Umbrel.Core;
using Xunit;

namespace Umbrel.Core.Tests;

public class FallbackDiscoveryTests
{
	private static CancellationToken Ct => TestContext.Current.CancellationToken;

	[Fact]
	public void FallbackHostsStaySmallAndPredictable() =>
		Assert.Equal(
			[
				"umbrel.local",
				"umbrel-2.local",
				"umbrel-3.local",
				"umbrel-4.local",
				"umbrel-5.local",
				"umbrel-home.local",
				"umbrel-pro.local",
			],
			Umbreld.FallbackDiscoveryHosts);

	[Fact]
	public void FallbackResponseReportsItsVersion() =>
		Assert.Equal("2.0.0", Umbreld.ValidateFallbackSystemVersion(
			Result("""{"result":{"data":{"version":"2.0.0","name":"umbrelOS 2.0"}}}""")));

	[Fact]
	public void OnlyReleasesBeforeUmbrelOs2RequireAnUpdate()
	{
		foreach (var version in new[] { "0.5.4", "1.0.0", "1.4.2", "1.7.4" })
		{
			Assert.True(Umbreld.RequiresUpdate(version), version);
		}
		foreach (var version in new[] { "2.0.0", "2.0.0-beta.1", "2.0.1", "2.1.0", "10.0.0" })
		{
			Assert.False(Umbreld.RequiresUpdate(version), version);
		}
		// Never tell someone to update on a version that can't be read
		foreach (var version in new[] { "", "beta", "v1.7.4" })
		{
			Assert.False(Umbreld.RequiresUpdate(version), version);
		}
	}

	[Fact]
	public async Task CurrentFallbackHostsAreIdentifiedAndOnlyOlderOnesNeedAnUpdate()
	{
		var versions = new Dictionary<string, string>
		{
			["umbrel.local"] = "2.0.0",
			["umbrel-2.local"] = "1.7.4",
			["umbrel-3.local"] = "2.0.0-beta.2",
			["umbrel-pro.local"] = "2.1.0",
		};
		var attempts = new ConcurrentQueue<(string Host, IReadOnlySet<string> KnownDeviceIds)>();
		var result = await DiscoverAsync(versions, knownDeviceIds: new HashSet<string> { "saved" }, identify: (candidate, known) =>
		{
			attempts.Enqueue((candidate.Host, known));
			// umbrel-pro.local answers its version but never proves its identity
			return Task.FromResult<Umbreld.HostIdentification>(candidate.Host == "umbrel-pro.local"
				? new Umbreld.HostIdentification.Unverified(new Umbreld.UnverifiedDevice(candidate.Host, Umbreld.UnverifiedReason.Slow))
				: new Umbreld.HostIdentification.Device(Device(candidate.Host, $"id-{candidate.Host}")));
		});

		Assert.Equal(["umbrel-3.local", "umbrel.local"], result.Devices.Select(device => device.Host));
		var unverified = Assert.Single(result.Unverified);
		Assert.Equal(("umbrel-pro.local", Umbreld.UnverifiedReason.Slow), (unverified.Host, unverified.Reason));
		Assert.Equal([new Umbreld.UpdateRequiredDevice("umbrel-2.local")], result.UpdateRequired);
		// A slow Umbrel isn't asked twice, and older Umbrels are never asked
		Assert.Equal(["umbrel-3.local", "umbrel-pro.local", "umbrel.local"], attempts.Select(attempt => attempt.Host).Order(StringComparer.Ordinal));
		Assert.All(attempts, attempt => Assert.Equal(["saved"], attempt.KnownDeviceIds));
	}

	[Fact]
	public async Task UnexpectedFailureIsAskedOnceMore()
	{
		var attempts = 0;
		var result = await DiscoverAsync(new() { ["umbrel.local"] = "2.0.0" }, identify: (candidate, _) =>
			// Still starting the first time, ready the second
			Task.FromResult<Umbreld.HostIdentification>(Interlocked.Increment(ref attempts) == 1
				? new Umbreld.HostIdentification.Unverified(new Umbreld.UnverifiedDevice(candidate.Host, Umbreld.UnverifiedReason.Unexpected))
				: new Umbreld.HostIdentification.Device(Device(candidate.Host, "home"))));

		Assert.Equal(2, attempts);
		Assert.Equal("home", Assert.Single(result.Devices).Id);
		Assert.Empty(result.Unverified);
	}

	[Fact]
	public async Task AHungIdentificationEndsAtTheDeadlineAsSlow()
	{
		var attempts = 0;
		var started = Stopwatch.StartNew();
		var result = await DiscoverAsync(
			new() { ["umbrel.local"] = "2.0.0" },
			addresses: new() { ["umbrel.local"] = ["192.168.1.10"] },
			attemptDeadline: TimeSpan.FromMilliseconds(200),
			identify: async (candidate, _) =>
			{
				Interlocked.Increment(ref attempts);
				await Task.Delay(TimeSpan.FromSeconds(30), Ct);
				return new Umbreld.HostIdentification.Device(Device(candidate.Host, "home"));
			});

		Assert.True(started.Elapsed < TimeSpan.FromSeconds(2));
		var unverified = Assert.Single(result.Unverified);
		Assert.Equal(("umbrel.local", Umbreld.UnverifiedReason.Slow), (unverified.Host, unverified.Reason));
		Assert.Equal(["192.168.1.10"], unverified.Addresses);
		Assert.Equal(1, attempts);
	}

	[Fact]
	public async Task TwoNamesForTheSameUmbrelShowOnce()
	{
		var result = await DiscoverAsync(new() { ["umbrel.local"] = "2.0.0", ["umbrel-home.local"] = "2.0.0" }, identify: (candidate, _) =>
			Task.FromResult<Umbreld.HostIdentification>(
				new Umbreld.HostIdentification.Device(Device(candidate.Host, "home", Encoding.UTF8.GetBytes("home-ca")))));

		Assert.Equal(["umbrel-home.local"], result.Devices.Select(device => device.Host));
	}

	[Fact]
	public async Task AClaimedIdUnderAnotherCaDoesNotHideTheRealUmbrel()
	{
		var result = await DiscoverAsync(new() { ["umbrel.local"] = "2.0.0", ["umbrel-2.local"] = "2.0.0" }, identify: (candidate, _) =>
		{
			var certificate = candidate.Host == "umbrel.local" ? "home-ca" : "impostor-ca";
			return Task.FromResult<Umbreld.HostIdentification>(
				new Umbreld.HostIdentification.Device(Device(candidate.Host, "home", Encoding.UTF8.GetBytes(certificate))));
		});

		Assert.Equal(["umbrel-2.local", "umbrel.local"], result.Devices.Select(device => device.Host));
	}

	[Fact]
	public async Task AnotherNameForAVerifiedUmbrelIsNotAFailure()
	{
		var result = await DiscoverAsync(
			new() { ["umbrel.local"] = "2.0.0", ["umbrel-2.local"] = "2.0.0" },
			addresses: new() { ["umbrel.local"] = ["192.168.1.10"], ["umbrel-2.local"] = ["192.168.1.10"] },
			identify: (candidate, _) => Task.FromResult<Umbreld.HostIdentification>(candidate.Host == "umbrel.local"
				? new Umbreld.HostIdentification.Device(Device(candidate.Host, "home", addresses: candidate.Addresses))
				: new Umbreld.HostIdentification.Unverified(
					new Umbreld.UnverifiedDevice(candidate.Host, candidate.Addresses, Umbreld.UnverifiedReason.Slow))));

		Assert.Equal(["umbrel.local"], result.Devices.Select(device => device.Host));
		Assert.Empty(result.Unverified);
	}

	[Fact]
	public async Task ASavedUmbrelWithAChangedCertificateIsLeftToItsOwnHandling()
	{
		var result = await DiscoverAsync(new() { ["umbrel.local"] = "2.0.0" }, identify: (_, _) =>
			Task.FromResult<Umbreld.HostIdentification>(new Umbreld.HostIdentification.SavedIdentityChanged()));

		Assert.Empty(result.Devices);
		Assert.Empty(result.Unverified);
		Assert.Empty(result.UpdateRequired);
	}

	[Fact]
	public async Task UpdateHintsArriveBeforeIdentificationFinishes()
	{
		var events = new ConcurrentQueue<string>();
		var result = await DiscoverAsync(
			new() { ["umbrel.local"] = "2.0.0", ["umbrel-2.local"] = "1.7.4" },
			onUpdateRequired: devices =>
			{
				events.Enqueue($"update hints: {string.Join(", ", devices.Select(device => device.Host))}");
				return Task.CompletedTask;
			},
			identify: async (candidate, _) =>
			{
				await Task.Delay(100, Ct);
				events.Enqueue($"identified {candidate.Host}");
				return new Umbreld.HostIdentification.Device(Device(candidate.Host, "home"));
			});

		Assert.Equal(["update hints: umbrel-2.local", "identified umbrel.local"], events);
		Assert.Equal([new Umbreld.UpdateRequiredDevice("umbrel-2.local")], result.UpdateRequired);
	}

	[Fact]
	public async Task FallbackWithOnlyOlderUmbrelsSkipsIdentification()
	{
		var attempts = 0;
		var result = await DiscoverAsync(new() { ["umbrel.local"] = "1.7.4" }, identify: (candidate, _) =>
		{
			Interlocked.Increment(ref attempts);
			return Task.FromResult<Umbreld.HostIdentification>(
				new Umbreld.HostIdentification.Unverified(new Umbreld.UnverifiedDevice(candidate.Host, Umbreld.UnverifiedReason.Unexpected)));
		});

		Assert.Empty(result.Devices);
		Assert.Empty(result.Unverified);
		Assert.Equal([new Umbreld.UpdateRequiredDevice("umbrel.local")], result.UpdateRequired);
		Assert.Equal(0, attempts);
	}

	[Fact]
	public async Task DeadlineReturnsAFastResultAndCutsOffASlowOne()
	{
		var fast = await Umbreld.WithDeadlineAsync<string>(TimeSpan.FromSeconds(5), _ => Task.FromResult<string?>("done"), Ct);
		Assert.Equal("done", fast);

		var started = Stopwatch.StartNew();
		var slow = await Umbreld.WithDeadlineAsync<string>(TimeSpan.FromMilliseconds(100), async token =>
		{
			await Task.Delay(TimeSpan.FromSeconds(30), token);
			return "too late";
		}, Ct);
		Assert.Null(slow);
		Assert.True(started.Elapsed < TimeSpan.FromSeconds(2));
	}

	[Fact]
	public void FallbackDevicesAreNamedLikeDnsSdNamesThem()
	{
		Assert.Equal("umbrel", Umbreld.FallbackDeviceName("umbrel.local"));
		Assert.Equal("umbrel-home", Umbreld.FallbackDeviceName("umbrel-home.local"));
	}

	private static Task<Umbreld.FallbackDiscoveryResult> DiscoverAsync(
		Dictionary<string, string> versions,
		Func<Candidate, IReadOnlySet<string>, Task<Umbreld.HostIdentification>> identify,
		Dictionary<string, IReadOnlyList<string>>? addresses = null,
		IReadOnlySet<string>? knownDeviceIds = null,
		TimeSpan? attemptDeadline = null,
		Func<IReadOnlyList<Umbreld.UpdateRequiredDevice>, Task>? onUpdateRequired = null) =>
		Umbreld.DiscoverFallbackHostsAsync(
			knownDeviceIds ?? new HashSet<string>(),
			(host, _) => Task.FromResult(versions.GetValueOrDefault(host)),
			(host, _) => Task.FromResult(new Candidate(
				host,
				addresses?.GetValueOrDefault(host) ?? [],
				Umbreld.FallbackDeviceName(host))),
			(candidate, known, _) => identify(candidate, known),
			TimeSpan.Zero,
			attemptDeadline ?? TimeSpan.FromSeconds(5),
			onUpdateRequired ?? (_ => Task.CompletedTask),
			Ct);

	private static IdentifiedDevice Device(
		string host,
		string id,
		byte[]? certificate = null,
		IReadOnlyList<string>? addresses = null) => new()
	{
		Host = host,
		DiscoveryHost = host,
		Addresses = addresses ?? [],
		Name = Umbreld.FallbackDeviceName(host),
		Id = id,
		Model = "Umbrel Home",
		Onboarded = true,
		CandidateCaCertificate = certificate,
	};

	private static HttpResult Result(string body) => new(200, Encoding.UTF8.GetBytes(body), "application/json");
}
