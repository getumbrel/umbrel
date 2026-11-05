using Umbrel.Core;

namespace Umbrel;

public enum DeviceReachability
{
	Unverified,
	Online,
	Offline,
}

public enum ConnectionState
{
	NotAuthenticated,
	Connecting,
	Connected,
	Disconnecting,
	Expired,
}

public enum MountStatus
{
	Mounting,
	Mounted,
	Unmounting,
	Unmounted,
}

public sealed record Share(string Name, string Path, string Sharename, string? MountPath, MountStatus Status)
{
	public string Id => Sharename;
}

/// <summary>One row in the panel: a saved device, a discovered device, or both.</summary>
public sealed record Device
{
	public required string Id { get; init; }
	public required string Name { get; init; } // DNS-SD instance name, usually the hostname
	public required string Host { get; init; } // DNS-SD hostname, e.g. "umbrel.local"
	public string? ConnectionHost { get; init; } // endpoint chosen for native traffic
	public IReadOnlyList<string> Addresses { get; init; } = []; // IPv4 addresses
	public string? Model { get; init; } // e.g. "Umbrel Home (2025)", from the identity probe
	public string? UserName { get; init; }
	public DeviceReachability Reachability { get; init; }
	public bool Saved { get; init; }
	public ConnectionState Connection { get; init; }
	public IReadOnlyList<Share> Shares { get; init; } = [];
	public bool? Onboarded { get; init; } // null when unknown (offline)
	public bool DashboardUsesHttps { get; init; } // browser links only, not native traffic
	// Offline, and one of its addresses proved its id under a new CA, as after a reset
	public bool IdentityChanged { get; init; }

	public bool Online => Reachability == DeviceReachability.Online;
	public string DisplayModel => Model ?? Name;
	public string DisplayName => UserName is null ? DisplayModel : $"{UserName}\u2019s {DisplayModel}";
	public UmbrelDeviceKind Kind => UmbrelDeviceKindExtensions.FromModel(Model);
}
