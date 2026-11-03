using Umbrel.Core;
using Xunit;

namespace Umbrel.Core.Tests;

public class EndpointResolverTests
{
	private static NativeEndpointResolver.Verify Verifier(Func<string, EndpointVerification> outcome, TimeSpan? delay = null) =>
		async (host, _, ct) =>
		{
			if (delay is { } wait) await Task.Delay(wait, ct);
			return outcome(host);
		};

	[Fact]
	public async Task ReturnsTheFirstVerifiedHost()
	{
		var resolver = new NativeEndpointResolver();
		var target = new Umbreld.Target("dev", ["bad.local", "192.168.1.5"]);
		var host = await resolver.ResolveAsync(target,
			Verifier(host => host == "192.168.1.5" ? new EndpointVerification.Verified() : new EndpointVerification.Unavailable()),
			CancellationToken.None);
		Assert.Equal("192.168.1.5", host);
	}

	[Fact]
	public async Task PrefersTailscaleWhenItAnswersPromptly()
	{
		var resolver = new NativeEndpointResolver(TimeSpan.FromSeconds(1));
		var target = new Umbreld.Target("dev", ["192.168.1.5", "100.64.0.9"]);
		var host = await resolver.ResolveAsync(target, Verifier(_ => new EndpointVerification.Verified()), CancellationToken.None);
		Assert.Equal("100.64.0.9", host);
	}

	[Fact]
	public async Task FallsBackLocallyWhenTailscaleIsSlow()
	{
		var resolver = new NativeEndpointResolver(TimeSpan.FromMilliseconds(100));
		var target = new Umbreld.Target("dev", ["192.168.1.5", "100.64.0.9"]);
		var host = await resolver.ResolveAsync(target,
			async (candidate, _, ct) =>
			{
				if (SavedDevice.IsTailscaleAddress(candidate)) await Task.Delay(TimeSpan.FromSeconds(2), ct);
				return new EndpointVerification.Verified();
			},
			CancellationToken.None);
		Assert.Equal("192.168.1.5", host);
	}

	[Fact]
	public async Task ReportsTheStrongestRejection()
	{
		var resolver = new NativeEndpointResolver();
		var target = new Umbreld.Target("dev", ["a.local", "b.local"]);
		var error = await Assert.ThrowsAsync<EndpointRejectionException>(() => resolver.ResolveAsync(target,
			Verifier(host => host == "a.local"
				? new EndpointVerification.Rejected(EndpointRejectionKind.ProtocolFailure, "p")
				: new EndpointVerification.Rejected(EndpointRejectionKind.Trust, "t")),
			CancellationToken.None));
		Assert.Equal(EndpointRejectionKind.Trust, error.Kind);
	}

	[Fact]
	public async Task CachesTheWinnerUntilInvalidated()
	{
		var resolver = new NativeEndpointResolver();
		var target = new Umbreld.Target("dev", ["192.168.1.5"]);
		var calls = 0;
		NativeEndpointResolver.Verify verify = (_, _, _) =>
		{
			calls++;
			return Task.FromResult<EndpointVerification>(new EndpointVerification.Verified());
		};
		await resolver.ResolveAsync(target, verify, CancellationToken.None);
		await resolver.ResolveAsync(target, verify, CancellationToken.None);
		Assert.Equal(1, calls);
		resolver.Invalidate("dev");
		await resolver.ResolveAsync(target, verify, CancellationToken.None);
		Assert.Equal(2, calls);
	}

	[Fact]
	public void TargetsDeduplicateHosts()
	{
		var target = new Umbreld.Target("dev", ["A.local", "a.local", "", "b.local"]);
		Assert.Equal(["A.local", "b.local"], target.Hosts);
	}
}
