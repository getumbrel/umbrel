using System.Runtime.Versioning;
using Windows.Devices.Enumeration;

namespace Umbrel.Core;

/// <summary>
/// Browses for _umbrel._tcp through Windows' DNS-SD resolver
/// (<see cref="DeviceInformation.CreateWatcher(string, IEnumerable{string}, DeviceInformationKind)"/>
/// with the DNS-SD protocol id). Only devices advertising this service are
/// discoverable, and results remain unverified candidates until system.discoveryInfo
/// establishes their identity over pinned HTTPS. Windows' own service does the
/// multicast and the app never listens for inbound traffic, so the firewall never prompts.
///
/// Windows.Devices.Enumeration is the API Microsoft documents for DNS-SD browsing in
/// desktop apps; the older Windows.Networking.ServiceDiscovery.Dnssd watcher is marked
/// unsupported. Candidate snapshots are published through <see cref="Update"/> on the
/// thread that caused the change (a thread-pool thread for watcher events); callers
/// marshal to their UI thread.
/// </summary>
[SupportedOSPlatform("windows10.0.19041.0")]
public sealed class Discovery : IDisposable
{
	private const string DnssdProtocolId = "{4526e8c1-8aac-4153-9b16-55e86ada0e54}";
	private const string ServiceName = "_umbrel._tcp";
	private const string HostNameProperty = "System.Devices.Dnssd.HostName";
	private const string InstanceNameProperty = "System.Devices.Dnssd.InstanceName";
	private const string IpAddressProperty = "System.Devices.IpAddress";
	private const string TextAttributesProperty = "System.Devices.Dnssd.TextAttributes";
	private const string PortNumberProperty = "System.Devices.Dnssd.PortNumber";

	private static readonly string AqsFilter =
		$"System.Devices.AepService.ProtocolId:={DnssdProtocolId}" +
		" AND System.Devices.Dnssd.Domain:=\"local\"" +
		$" AND System.Devices.Dnssd.ServiceName:=\"{ServiceName}\"";

	private static readonly string[] RequestedProperties =
	[
		HostNameProperty,
		"System.Devices.Dnssd.ServiceName",
		InstanceNameProperty,
		IpAddressProperty,
		PortNumberProperty,
		TextAttributesProperty,
	];

	private sealed record Entry(string? Host, IReadOnlyList<string> Addresses, string Name, string? Id, string? Model, bool? Onboarded);

	private readonly object _gate = new();
	private readonly Dictionary<string, Entry> _entries = new(StringComparer.Ordinal);
	private readonly SnapshotRelay<IReadOnlyList<Candidate>> _relay;
	private DeviceWatcher? _watcher;

	public Discovery() => _relay = new SnapshotRelay<IReadOnlyList<Candidate>>(snapshot => Update?.Invoke(snapshot));

	/// <summary>Fires with a fresh candidate snapshot after every change.</summary>
	public event Action<IReadOnlyList<Candidate>>? Update;

	public void Start()
	{
		lock (_gate)
		{
			if (_watcher is not null) return;
			var watcher = DeviceInformation.CreateWatcher(
				AqsFilter,
				RequestedProperties,
				DeviceInformationKind.AssociationEndpointService);
			watcher.Added += OnAdded;
			watcher.Updated += OnUpdated;
			watcher.Removed += OnRemoved;
			_watcher = watcher;
			watcher.Start();
		}
	}

	public void Stop()
	{
		DeviceWatcher? watcher;
		lock (_gate)
		{
			watcher = _watcher;
			_watcher = null;
			_entries.Clear();
		}
		if (watcher is null) return;
		watcher.Added -= OnAdded;
		watcher.Updated -= OnUpdated;
		watcher.Removed -= OnRemoved;
		if (watcher.Status is DeviceWatcherStatus.Started or DeviceWatcherStatus.EnumerationCompleted)
		{
			watcher.Stop();
		}
		// Publish the cleared snapshot so a restarted browse starts from nothing.
		Publish();
	}

	public void Dispose() => Stop();

	private void OnAdded(DeviceWatcher sender, DeviceInformation information)
	{
		lock (_gate)
		{
			if (!ReferenceEquals(sender, _watcher)) return;
			_entries[information.Id] = Parse(information.Name, information.Properties);
		}
		Publish();
	}

	private void OnUpdated(DeviceWatcher sender, DeviceInformationUpdate update)
	{
		lock (_gate)
		{
			if (!ReferenceEquals(sender, _watcher)) return;
			if (!_entries.TryGetValue(update.Id, out var existing)) return;
			_entries[update.Id] = Merge(existing, update.Properties);
		}
		Publish();
	}

	private void OnRemoved(DeviceWatcher sender, DeviceInformationUpdate update)
	{
		lock (_gate)
		{
			if (!ReferenceEquals(sender, _watcher)) return;
			_entries.Remove(update.Id);
		}
		Publish();
	}

	private static Entry Parse(string name, IReadOnlyDictionary<string, object> properties)
	{
		var host = StringProperty(properties, HostNameProperty);
		var instance = StringProperty(properties, InstanceNameProperty) ?? name;
		var (id, model, onboarded) = ParseTxt(StringsProperty(properties, TextAttributesProperty));
		return new Entry(NormalizeHost(host), IPv4Addresses(StringsProperty(properties, IpAddressProperty)), instance, id, model, onboarded);
	}

	private static Entry Merge(Entry existing, IReadOnlyDictionary<string, object> properties)
	{
		var host = properties.ContainsKey(HostNameProperty)
			? NormalizeHost(StringProperty(properties, HostNameProperty)) ?? existing.Host
			: existing.Host;
		// Windows often reports a host's IPv6 address alone in an update, then both again, so
		// an update without IPv4 addresses doesn't mean the known ones went away.
		var reported = IPv4Addresses(StringsProperty(properties, IpAddressProperty));
		var addresses = reported.Count > 0 ? reported : existing.Addresses;
		var name = StringProperty(properties, InstanceNameProperty) ?? existing.Name;
		var (id, model, onboarded) = properties.ContainsKey(TextAttributesProperty)
			? ParseTxt(StringsProperty(properties, TextAttributesProperty))
			: (existing.Id, existing.Model, existing.Onboarded);
		return new Entry(host, addresses, name, id, model, onboarded);
	}

	private static string? StringProperty(IReadOnlyDictionary<string, object> properties, string key) =>
		properties.TryGetValue(key, out var value) && value is string text && text.Length > 0 ? text : null;

	private static IReadOnlyList<string> StringsProperty(IReadOnlyDictionary<string, object> properties, string key) =>
		properties.TryGetValue(key, out var value) switch
		{
			true when value is string[] array => array,
			true when value is string text => [text],
			_ => [],
		};

	private static string? NormalizeHost(string? host)
	{
		if (host is null) return null;
		var trimmed = host.EndsWith('.') ? host[..^1] : host;
		return trimmed.Length == 0 ? null : trimmed;
	}

	// DNS-SD may report IPv6 addresses too; the apps speak to IPv4 endpoints only, and
	// the pinned certificate carries IPv4 SANs.
	private static IReadOnlyList<string> IPv4Addresses(IReadOnlyList<string> addresses) =>
		addresses.Where(SavedDevice.IsIPv4Address).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).ToList();

	private static (string? Id, string? Model, bool? Onboarded) ParseTxt(IReadOnlyList<string> attributes)
	{
		string? id = null, model = null;
		bool? onboarded = null;
		foreach (var attribute in attributes)
		{
			var separator = attribute.IndexOf('=');
			if (separator <= 0) continue;
			var key = attribute[..separator];
			var value = attribute[(separator + 1)..];
			if (value.Length == 0) continue;
			switch (key)
			{
				case "id":
					id = value;
					break;
				case "device":
					model = value;
					break;
				case "onboarded":
					onboarded = value == "1";
					break;
			}
		}
		return (id, model, onboarded);
	}

	/// <summary>
	/// Builds the candidate list from resolved services. The same device can appear once
	/// per network interface, so entries are merged by host.
	/// </summary>
	private void Publish()
	{
		lock (_gate)
		{
			var byHost = new Dictionary<string, Candidate>(StringComparer.OrdinalIgnoreCase);
			foreach (var entry in _entries.Values)
			{
				if (entry.Host is null) continue; // not resolved yet
				// Any LAN peer can advertise any target name. Skip anything that isn't a
				// literal IPv4 address or .local name before it reaches identification.
				if (!SavedDevice.IsValidLocalEndpointHost(entry.Host)) continue;
				var candidate = new Candidate(entry.Host, entry.Addresses, entry.Name, entry.Id, entry.Model, entry.Onboarded);
				if (byHost.TryGetValue(entry.Host, out var existing))
				{
					candidate = candidate with
					{
						Addresses = existing.Addresses.Concat(candidate.Addresses)
							.Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).ToList(),
					};
				}
				byHost[entry.Host] = candidate;
			}
			// Staged inside the lock that built it, so snapshots queue in the order the
			// watcher changes happened even though events arrive on several threads.
			_relay.Stage(byHost.Values.OrderBy(candidate => candidate.Host, StringComparer.Ordinal).ToList());
		}
		_relay.Deliver();
	}
}

/// <summary>
/// Delivers values one at a time and only the newest: a value staged while another is
/// being delivered replaces any older pending value and goes out once that delivery
/// returns. Callbacks never run under the caller's lock, and an older snapshot can never
/// land after a newer one. The Apple client gets the same order from its serial queue.
/// </summary>
internal sealed class SnapshotRelay<T>(Action<T> deliver) where T : class
{
	private readonly object _gate = new();
	private T? _pending;
	private bool _delivering;

	/// <summary>Call in production order, typically while holding the lock that built the value.</summary>
	public void Stage(T value)
	{
		lock (_gate) _pending = value;
	}

	/// <summary>Deliver pending values on this thread unless another thread already is.</summary>
	public void Deliver()
	{
		lock (_gate)
		{
			if (_delivering) return;
			_delivering = true;
		}
		try
		{
			while (true)
			{
				T next;
				lock (_gate)
				{
					if (_pending is null)
					{
						_delivering = false;
						return;
					}
					next = _pending;
					_pending = null;
				}
				deliver(next);
			}
		}
		catch
		{
			lock (_gate) _delivering = false;
			throw;
		}
	}
}
