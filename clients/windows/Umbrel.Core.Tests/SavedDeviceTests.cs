using Umbrel.Core;
using Xunit;

namespace Umbrel.Core.Tests;

public class SavedDeviceTests
{
	[Theory]
	[InlineData("100.64.0.1", true)]
	[InlineData("100.127.255.254", true)]
	[InlineData("100.128.0.1", false)]
	[InlineData("100.63.255.255", false)]
	[InlineData("192.168.1.5", false)]
	[InlineData("umbrel.local", false)]
	public void TailscaleRangeIsExactlyCgnat(string address, bool expected) =>
		Assert.Equal(expected, SavedDevice.IsTailscaleAddress(address));

	[Theory]
	[InlineData("192.168.1.5", true)]
	[InlineData("10.0.0.1", true)]
	[InlineData("172.16.0.1", true)]
	[InlineData("172.32.0.1", false)]
	[InlineData("169.254.10.10", true)]
	[InlineData("100.64.1.1", true)]
	[InlineData("8.8.8.8", false)]
	[InlineData("192.168.01.5", false)]
	[InlineData("256.1.1.1", false)]
	public void ManualIPv4RangesMatchThePlaintextBootstrapPolicy(string address, bool expected) =>
		Assert.Equal(expected, SavedDevice.IsSupportedManualIPv4Address(address));

	[Theory]
	[InlineData("umbrel.local", true)]
	[InlineData("umbrel-2.local", true)]
	[InlineData("UMBREL.LOCAL", true)]
	[InlineData("local", false)]
	[InlineData("umbrel.example.com", false)]
	[InlineData("-bad.local", false)]
	[InlineData("bad_.local", false)]
	public void BonjourHostnamesEndInLocal(string host, bool expected) =>
		Assert.Equal(expected, SavedDevice.IsBonjourHostname(host));

	[Fact]
	public void ConnectionHostsDeduplicateCaseInsensitively()
	{
		var device = new SavedDevice
		{
			Id = "id",
			Name = "Umbrel",
			Host = "umbrel.local",
			Addresses = ["192.168.1.5", "UMBREL.LOCAL", "", "192.168.1.5"],
		};
		Assert.Equal(["umbrel.local", "192.168.1.5"], device.ConnectionHosts);
	}

	[Fact]
	public void MergeVerifiedDiscoveryReplacesBonjourNamesAndKeepsIps()
	{
		var device = new SavedDevice
		{
			Id = "id",
			Name = "Old",
			Host = "old.local",
			Addresses = ["old.local", "192.168.1.5"],
		};
		var discovered = new IdentifiedDevice
		{
			Host = "192.168.1.9",
			DiscoveryHost = "umbrel.local",
			Addresses = ["192.168.1.9"],
			Name = "Umbrel",
			Id = "id",
			Model = "Umbrel Home",
			Onboarded = true,
		};
		var merged = device.MergeVerifiedDiscovery(discovered);
		Assert.Equal("192.168.1.9", merged.Host);
		Assert.Equal(["192.168.1.5", "192.168.1.9"], merged.Addresses);
		Assert.Equal("Umbrel Home", merged.Model);
		Assert.Same(device, device.MergeVerifiedDiscovery(discovered with { Id = "other" }));
	}

	[Fact]
	public void StoredRoutesKeepOnlyLocalHosts()
	{
		var device = new SavedDevice { Id = "id", Name = "Umbrel", Host = "umbrel.local" };
		string[] reported = ["192.168.1.5", "fe80::1", "umbrel.example.com", "100.64.0.1", "umbrel.local", "user@host.local", ""];
		Assert.Equal(["192.168.1.5", "100.64.0.1", "umbrel.local"], device.ReplaceAvailableAddresses(reported).Addresses);
		Assert.Equal(["192.168.1.5", "100.64.0.1", "umbrel.local"], device.RememberConnectionCandidates(reported).Addresses);

		var discovered = new IdentifiedDevice
		{
			Host = "umbrel.example.com",
			DiscoveryHost = "umbrel.local",
			Addresses = ["192.168.1.9"],
			Name = "Umbrel",
			Id = "id",
			Model = "Umbrel Home",
			Onboarded = true,
		};
		Assert.Same(device, device.MergeVerifiedDiscovery(discovered));
		Assert.Equal(["192.168.1.9"], device.MergeVerifiedDiscovery(discovered with
		{
			Host = "192.168.1.9",
			Addresses = ["192.168.1.9", "evil.example.com"],
		}).Addresses);
	}

	private static SavedDevice FullyPopulated() => new()
	{
		Id = "id",
		Name = "Umbrel",
		Host = "umbrel.local",
		Addresses = ["192.168.1.5"],
		Model = "Umbrel Home",
		UserName = "Patrick",
		WallpaperId = "18",
		AccountProfiles = new Dictionary<string, SavedAccountProfile>
		{
			["0"] = new() { Name = "Patrick", WallpaperId = "18", Role = "owner" },
		},
		LastAccountId = "0",
		DashboardUsesHttps = false,
		SuppressHttpsRequiredAppWarning = false,
	};

	[Fact]
	public void EqualityComparesContentsSoUnchangedConfigIsNotRewritten()
	{
		var device = FullyPopulated();
		var rebuilt = device
			.ReplaceAvailableAddresses(["192.168.1.5"])
			.SaveAccountProfile("0", "Patrick", "18", null, "owner");
		Assert.NotSame(device.Addresses, rebuilt.Addresses);
		Assert.Equal(device, rebuilt);
		Assert.Equal(device.GetHashCode(), rebuilt.GetHashCode());

		Func<SavedDevice, SavedDevice>[] changes =
		[
			d => d with { Id = "other" },
			d => d with { Name = "Other" },
			d => d with { Host = "other.local" },
			d => d with { Addresses = ["192.168.1.6"] },
			d => d with { Model = "Umbrel Pro" },
			d => d with { UserName = "Other" },
			d => d with { WallpaperId = "19" },
			d => d.SaveAccountProfile("0", "Patrick", "18", null, "member") with { UserName = d.UserName, WallpaperId = d.WallpaperId },
			d => d with { LastAccountId = "1" },
			d => d with { DashboardUsesHttps = true },
			d => d with { SuppressHttpsRequiredAppWarning = true },
		];
		// A property added to SavedDevice must also be added to Equals and to this list.
		Assert.Equal(typeof(SavedDevice).GetProperties().Count(property => property.CanWrite), changes.Length);
		Assert.All(changes, change => Assert.NotEqual(device, change(device)));
	}

	[Fact]
	public void SaveAccountProfileCachesPresentationForOfflineCards()
	{
		var device = new SavedDevice { Id = "id", Name = "Umbrel", Host = "umbrel.local" };
		var saved = device.SaveAccountProfile("0", "Patrick", "18", "259 100% 59%", "owner");
		Assert.Equal("Patrick", saved.UserName);
		Assert.Equal("18", saved.WallpaperId);
		Assert.Equal("0", saved.LastAccountId);
		Assert.Equal("Patrick’s Umbrel", saved.DisplayName);
		Assert.Equal("owner", saved.AccountProfile("0")!.Role);
	}

	[Theory]
	[InlineData("Umbrel Home", UmbrelDeviceKind.Home)]
	[InlineData("umbrel pro", UmbrelDeviceKind.Pro)]
	[InlineData("ASUS NUC 14 Essential", UmbrelDeviceKind.AsusNuc14Essential)]
	[InlineData("ASUS NUC 16 Pro", UmbrelDeviceKind.AsusNuc16Pro)]
	[InlineData("ASUS ROG NUC 16", UmbrelDeviceKind.AsusRogNuc16)]
	[InlineData("Raspberry Pi 5", UmbrelDeviceKind.RaspberryPi)]
	// umbreld names an ASUS NUC it has no render for just "ASUS NUC"
	[InlineData("ASUS NUC", UmbrelDeviceKind.Generic)]
	[InlineData("Docker Container", UmbrelDeviceKind.Generic)]
	[InlineData(null, UmbrelDeviceKind.Generic)]
	public void DeviceKindClassifiesModels(string? model, UmbrelDeviceKind expected) =>
		Assert.Equal(expected, UmbrelDeviceKindExtensions.FromModel(model));
}
