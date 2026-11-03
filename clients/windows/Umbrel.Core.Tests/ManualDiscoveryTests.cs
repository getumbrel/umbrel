using Umbrel.Core;
using Xunit;

namespace Umbrel.Core.Tests;

public class ManualDiscoveryTests
{
	[Theory]
	[InlineData("umbrel.local", "umbrel.local")]
	[InlineData(" UMBREL.LOCAL. ", "umbrel.local")]
	[InlineData("http://umbrel.local/", "umbrel.local")]
	[InlineData("https://192.168.1.5", "192.168.1.5")]
	[InlineData("umbrel", "umbrel")]
	[InlineData("umbrel.tail1234.ts.net", "umbrel.tail1234.ts.net")]
	[InlineData("HTTPS://Umbrel.Local/", "umbrel.local")]
	[InlineData("http://umbrel.local.", "umbrel.local")]
	public void AcceptedInputsNormalizeToAHost(string input, string expected) =>
		Assert.Equal(expected, Umbreld.ManualDiscoveryHostValue(input));

	[Theory]
	[InlineData("")]
	[InlineData("http://user:pw@umbrel.local/")]
	[InlineData("http://umbrel.local:8080/")]
	[InlineData("http://umbrel.local/path")]
	[InlineData("http://umbrel.local/?q=1")]
	[InlineData("8.8.8.8")]
	[InlineData("umbrel.example.com")]
	[InlineData("ftp://umbrel.local")]
	// System.Uri would rewrite these to 192.168.1.8, 192.168.0.1, and 127.0.0.1.
	[InlineData("http://192.168.001.010")]
	[InlineData("http://192.168.1")]
	[InlineData("http://0x7f.1")]
	[InlineData("http://umbrel.local:80")]
	[InlineData("http://umbrel.local/.")]
	[InlineData("http://umbrel.local?")]
	[InlineData("http://umbrel.local#")]
	[InlineData("http:\\\\umbrel.local")]
	[InlineData("http://umbrel.local\\")]
	[InlineData("https://[fe80::1]/")]
	public void RejectedInputsReturnNull(string input) =>
		Assert.Null(Umbreld.ManualDiscoveryHostValue(input));

	[Fact]
	public void DirectHostsBecomeCandidatesWithoutResolution()
	{
		var candidate = Umbreld.ManualDiscoveryCandidate("umbrel.local");
		Assert.NotNull(candidate);
		Assert.Equal("umbrel.local", candidate!.Host);
		Assert.Empty(candidate.Addresses);
	}

	[Fact]
	public void UnqualifiedHostnamesKeepOnlySupportedAddresses()
	{
		var candidate = Umbreld.ManualDiscoveryCandidate("umbrel", ["8.8.8.8", "192.168.1.5", "100.64.0.9", "192.168.1.5"]);
		Assert.NotNull(candidate);
		Assert.Equal("192.168.1.5", candidate!.Host);
		Assert.Equal(["100.64.0.9"], candidate.Addresses);
		Assert.Equal("umbrel", candidate.Name);
	}

	[Fact]
	public void MagicDnsNamesResolveOnlyToTailscaleAddresses()
	{
		Assert.Null(Umbreld.ManualDiscoveryCandidate("umbrel.tail1234.ts.net", ["192.168.1.5"]));
		var candidate = Umbreld.ManualDiscoveryCandidate("umbrel.tail1234.ts.net", ["192.168.1.5", "100.64.0.9"]);
		Assert.Equal("100.64.0.9", candidate!.Host);
	}

	[Fact]
	public void PassiveDiscoveryNeverIntroducesTailscaleEndpoints()
	{
		Assert.Null(Umbreld.LocalDiscoveryCandidate(new Candidate("100.64.0.9", "x")));
		var local = Umbreld.LocalDiscoveryCandidate(new Candidate("umbrel.local", ["100.64.0.9", "192.168.1.5"], "x"));
		Assert.Equal(["192.168.1.5"], local!.Addresses);
	}

	[Theory]
	[InlineData("umbrel.example.com")]
	[InlineData("attacker.example.com/trpc?x=")]
	[InlineData("user@umbrel.local")]
	[InlineData("umbrel.local:8080")]
	[InlineData("umbrel")]
	public void PassiveDiscoveryAcceptsOnlyLocalHosts(string host)
	{
		Assert.Null(Umbreld.LocalDiscoveryCandidate(new Candidate(host, "x")));
		var local = Umbreld.LocalDiscoveryCandidate(new Candidate("umbrel.local", [host, "192.168.1.5"], "x"));
		Assert.Equal(["192.168.1.5"], local!.Addresses);
	}

	[Fact]
	public async Task IdentificationNeverProbesNonLocalHosts()
	{
		var probed = new List<string>();
		Umbreld.IdentityProbe probe = (host, _, _) =>
		{
			lock (probed) probed.Add(host);
			return Task.FromResult<Umbreld.IdentityProbeResult?>(null);
		};
		var candidate = new Candidate("umbrel.example.com", ["192.168.1.5", "evil.example.com"], "x");
		var device = await Umbreld.IdentifyCandidateAsync(
			candidate, new HashSet<string>(), TestContext.Current.CancellationToken, allowsTailscaleHost: true, probe: probe);
		Assert.Null(device);
		Assert.Equal(["192.168.1.5"], probed);
	}

	[Fact]
	public async Task ReidentifyReportsFinishedSetupOverTheScannedAnchor()
	{
		var device = new IdentifiedDevice
		{
			Host = "192.168.4.23",
			DiscoveryHost = "umbrel-3.local",
			Addresses = ["192.168.4.23"],
			Name = "umbrel-3",
			Id = "new-device",
			Model = "Umbrel Home (2025)",
			Onboarded = false,
			CandidateCaCertificate = "candidate-ca"u8.ToArray(),
		};

		var result = await Umbreld.ReidentifyAsync(device, (host, anchor, _) =>
		{
			// Only the exact endpoint and anchor from the scan may answer
			var matches = host == "192.168.4.23"
				&& anchor is Umbreld.ReidentifyAnchor.Candidate candidate
				&& candidate.Certificate.SequenceEqual("candidate-ca"u8.ToArray());
			return Task.FromResult(matches ? new Umbreld.DiscoveryInfo("new-device", "Umbrel Home (2025)", true) : null);
		}, TestContext.Current.CancellationToken);

		Assert.True(result?.Onboarded);
		Assert.Equal(device.Host, result?.Host);
		Assert.Equal(device.DiscoveryHost, result?.DiscoveryHost);
		Assert.Same(device.CandidateCaCertificate, result?.CandidateCaCertificate);
	}

	[Fact]
	public async Task ReidentifyUsesThePinForAClaimedDevice()
	{
		var device = new IdentifiedDevice
		{
			Host = "umbrel.local",
			DiscoveryHost = "umbrel.local",
			Addresses = [],
			Name = "umbrel",
			Id = "claimed-device",
			Model = "Umbrel Home",
			Onboarded = false,
		};

		var result = await Umbreld.ReidentifyAsync(device, (host, anchor, _) =>
		{
			var matches = host == "umbrel.local" && anchor == new Umbreld.ReidentifyAnchor.Pinned("claimed-device");
			return Task.FromResult(matches ? new Umbreld.DiscoveryInfo("claimed-device", "Umbrel Home", true) : null);
		}, TestContext.Current.CancellationToken);

		Assert.True(result?.Onboarded);
		Assert.Null(result?.CandidateCaCertificate);
	}

	[Fact]
	public async Task ReidentifyRejectsADifferentUmbrelAtTheSameAddress()
	{
		var device = new IdentifiedDevice
		{
			Host = "umbrel.local",
			DiscoveryHost = "umbrel.local",
			Addresses = [],
			Name = "umbrel",
			Id = "new-device",
			Model = "Umbrel Home",
			Onboarded = false,
			CandidateCaCertificate = "candidate-ca"u8.ToArray(),
		};

		var replaced = await Umbreld.ReidentifyAsync(device, (_, _, _) =>
			Task.FromResult<Umbreld.DiscoveryInfo?>(new("other-device", "Umbrel Home", true)), TestContext.Current.CancellationToken);
		var unanswered = await Umbreld.ReidentifyAsync(device, (_, _, _) =>
			Task.FromResult<Umbreld.DiscoveryInfo?>(null), TestContext.Current.CancellationToken);

		Assert.Null(replaced);
		Assert.Null(unanswered);
	}
}
