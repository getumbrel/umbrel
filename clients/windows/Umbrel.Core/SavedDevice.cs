using System.Text.Json.Serialization;

namespace Umbrel.Core;

public sealed record SavedAccountProfile
{
	public required string Name { get; init; }
	public required string WallpaperId { get; init; }
	public string? WallpaperBrandColorHsl { get; init; }
	public required string Role { get; init; }
}

/// <summary>
/// Persisted shape of a saved device. Native grants live in the protected secret
/// store, never here. Field names match the Apple config.json so the model stays
/// one contract across clients.
/// </summary>
public sealed record SavedDevice
{
	public required string Id { get; init; }
	public required string Name { get; init; }
	public required string Host { get; init; }
	public IReadOnlyList<string> Addresses { get; init; } = [];
	public string? Model { get; init; }
	public string? UserName { get; init; }
	// Cached wallpaper ID for rendering the device card while offline.
	public string? WallpaperId { get; init; }
	// Identity and wallpaper belong to an account, not to the physical Umbrel. The
	// top-level fields cache the last-used presentation for device lists.
	public IReadOnlyDictionary<string, SavedAccountProfile>? AccountProfiles { get; init; }
	// Non-secret picker preference. It changes only after a successful login.
	public string? LastAccountId { get; init; }
	// Browser preferences are presentation-only.
	public bool? DashboardUsesHttps { get; init; }
	public bool? SuppressHttpsRequiredAppWarning { get; init; }

	public SavedAccountProfile? AccountProfile(string accountId) =>
		AccountProfiles is not null && AccountProfiles.TryGetValue(accountId, out var profile) ? profile : null;

	/// <summary>
	/// Every address must prove the stable discovery id through the device's pinned
	/// HTTPS CA before use. It remains one Umbrel account with multiple possible routes.
	/// </summary>
	public IReadOnlyList<string> ConnectionHosts => UniqueAddresses([Host, .. Addresses]);

	public Umbreld.Target NativeTarget => new(Id, ConnectionHosts);

	public static bool IsTailscaleAddress(string address)
	{
		var octets = Ipv4Octets(address);
		return octets is not null && octets[0] == 100 && octets[1] is >= 64 and <= 127;
	}

	public static bool IsIPv4Address(string address) => Ipv4Octets(address) is not null;

	/// <summary>
	/// Manual connections intentionally cover ordinary LANs, IPv4 link-local, and
	/// Tailscale. Other literal ranges are not reachable through the app's narrowly
	/// scoped plaintext bootstrap policy and fail validation immediately.
	/// </summary>
	internal static bool IsSupportedManualIPv4Address(string address)
	{
		var octets = Ipv4Octets(address);
		if (octets is null) return false;
		return (octets[0], octets[1]) switch
		{
			(10, _) => true,
			(172, >= 16 and <= 31) => true,
			(192, 168) => true,
			(169, 254) => true,
			(100, >= 64 and <= 127) => true,
			_ => false,
		};
	}

	private static int[]? Ipv4Octets(string address)
	{
		var parts = address.Split('.');
		if (parts.Length != 4) return null;
		var octets = new int[4];
		for (var i = 0; i < 4; i++)
		{
			var part = parts[i];
			if (part.Length == 0 || (part.Length > 1 && part[0] == '0')) return null;
			if (!part.All(char.IsAsciiDigit)) return null;
			if (!int.TryParse(part, out var value) || value > 255) return null;
			octets[i] = value;
		}
		return octets;
	}

	public static bool IsBonjourHostname(string host)
	{
		if (!IsDnsHostname(host)) return false;
		var labels = host.Split('.');
		return labels.Length >= 2 && labels[^1].Equals("local", StringComparison.OrdinalIgnoreCase);
	}

	internal static bool IsDnsHostname(string host)
	{
		if (host.Length == 0 || System.Text.Encoding.UTF8.GetByteCount(host) > 253) return false;
		foreach (var label in host.Split('.'))
		{
			if (label.Length is < 1 or > 63) return false;
			if (!char.IsAsciiLetterOrDigit(label[0]) || !char.IsAsciiLetterOrDigit(label[^1])) return false;
			if (!label.All(c => char.IsAsciiLetterOrDigit(c) || c == '-')) return false;
		}
		return true;
	}

	public static bool IsValidLocalEndpointHost(string host) => IsIPv4Address(host) || IsBonjourHostname(host);

	/// <summary>
	/// Only an IdentifiedDevice has proved the stable discovery id through the saved
	/// Umbrel's HTTPS identity. Its answering endpoint becomes primary, stale Bonjour
	/// names are discarded, and current IP candidates remain as fallbacks.
	/// </summary>
	public SavedDevice MergeVerifiedDiscovery(IdentifiedDevice discovered)
	{
		if (discovered.Id != Id || !IsValidLocalEndpointHost(discovered.Host)) return this;
		var kept = Addresses.Where(address => !IsBonjourHostname(address));
		return this with
		{
			Host = discovered.Host,
			Addresses = UniqueAddresses([.. kept, .. discovered.Addresses]),
			Name = discovered.Name,
			Model = discovered.Model,
		};
	}

	/// <summary>Keep a discovered route as a candidate without erasing other known routes.</summary>
	public SavedDevice RememberConnectionCandidates(IEnumerable<string> candidates) =>
		this with { Addresses = UniqueAddresses([.. Addresses, .. candidates]) };

	/// <summary>Once authenticated, the Umbrel itself is the authority on its current addresses.</summary>
	public SavedDevice ReplaceAvailableAddresses(IEnumerable<string> current) =>
		this with { Addresses = UniqueAddresses(current) };

	// Stored routes become request URLs and SMB targets. Keep only literal IPv4 addresses
	// and .local names, the hosts the Apple clients accept before using a saved route,
	// so a server-reported or advertised value can never name another kind of host.
	private static List<string> UniqueAddresses(IEnumerable<string> values)
	{
		var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
		return values.Where(value => IsValidLocalEndpointHost(value) && seen.Add(value)).ToList();
	}

	public SavedDevice SaveAccountProfile(
		string accountId,
		string name,
		string wallpaperId,
		string? wallpaperBrandColorHsl,
		string role)
	{
		var profiles = new Dictionary<string, SavedAccountProfile>(AccountProfiles ?? new Dictionary<string, SavedAccountProfile>())
		{
			[accountId] = new SavedAccountProfile
			{
				Name = name,
				WallpaperId = wallpaperId,
				WallpaperBrandColorHsl = wallpaperBrandColorHsl,
				Role = role,
			},
		};
		return this with
		{
			AccountProfiles = profiles,
			LastAccountId = accountId,
			// Device cards deliberately show the last-used account while signed out.
			UserName = name,
			WallpaperId = wallpaperId,
		};
	}

	/// <summary>Includes the user's name when available, for example "Patrick’s Umbrel Home".</summary>
	[JsonIgnore]
	public string DisplayName => UserName is null ? Model ?? Name : $"{UserName}’s {Model ?? Name}";

	// Records compare collections by reference, so a rebuilt but identical Addresses or
	// AccountProfiles would look like a change and rewrite config.json. Compare contents,
	// as Swift's synthesized Equatable does.
	public bool Equals(SavedDevice? other) =>
		other is not null &&
		Id == other.Id &&
		Name == other.Name &&
		Host == other.Host &&
		Addresses.SequenceEqual(other.Addresses) &&
		Model == other.Model &&
		UserName == other.UserName &&
		WallpaperId == other.WallpaperId &&
		ProfilesEqual(AccountProfiles, other.AccountProfiles) &&
		LastAccountId == other.LastAccountId &&
		DashboardUsesHttps == other.DashboardUsesHttps &&
		SuppressHttpsRequiredAppWarning == other.SuppressHttpsRequiredAppWarning;

	public override int GetHashCode() => HashCode.Combine(Id, Host, Addresses.Count);

	private static bool ProfilesEqual(
		IReadOnlyDictionary<string, SavedAccountProfile>? left,
		IReadOnlyDictionary<string, SavedAccountProfile>? right) =>
		left is null || right is null
			? left is null && right is null
			: left.Count == right.Count &&
				left.All(pair => right.TryGetValue(pair.Key, out var profile) && profile == pair.Value);
}
