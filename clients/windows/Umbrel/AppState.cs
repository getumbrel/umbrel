using System.Diagnostics;
using System.Windows.Threading;
using CommunityToolkit.Mvvm.ComponentModel;
using Microsoft.Win32;
using Umbrel.Services;
using Umbrel.Core;
using Umbrel.Views;
using Windows.Networking.Connectivity;

namespace Umbrel;

public abstract record AddressConnectionResult
{
	public sealed record Device(string Id) : AddressConnectionResult;
	public sealed record Unverified(Umbreld.UnverifiedDevice Value) : AddressConnectionResult;
	public sealed record UpdateRequired(string Host) : AddressConnectionResult;
}

public sealed class ShareUnmountException()
	: Exception("Some shared folders couldn’t be disconnected. Close any files open from this Umbrel, then try again.");

/// <summary>
/// The user chose to keep a drive with open files rather than force it. Nothing failed, so
/// the action stops without an error.
/// </summary>
public sealed class ShareUnmountCancelledException() : Exception("A drive with open files was kept connected.");

public sealed class DeviceIdentityUnavailableException()
	: Exception("Couldn’t verify this Umbrel. Scan the network and try again.");

/// <summary>
/// The single snapshot store behind the panel, the port of the macOS AppState. Every
/// mutation runs on the WPF dispatcher; network work is awaited without leaving it.
/// Discovery results, saved devices, reachability probes, sessions, and share mounts
/// merge into one <see cref="Devices"/> list on each <see cref="Rebuild"/>.
/// </summary>
public sealed class AppState : ObservableObject, IDisposable
{
	// A successful probe counts as online for this long (covers 2+ health cycles).
	private static readonly TimeSpan ProbeFreshness = TimeSpan.FromSeconds(150);
	// Don't re-probe the same device more often than this.
	private static readonly TimeSpan ProbeCooldown = TimeSpan.FromSeconds(30);
	private static readonly TimeSpan HealthInterval = TimeSpan.FromSeconds(60);

	private sealed record ProbeRecord(string? Host, Umbreld.DiscoveryInfo? Identity, DateTimeOffset CheckedAt)
	{
		public bool IsFresh(DateTimeOffset now) => now - CheckedAt < ProbeFreshness;
	}

	private sealed record SambaAccess(string AccountId, bool Enabled, string Username, string HomePath);

	private readonly Dispatcher _dispatcher;
	private readonly Config _config;
	private readonly Discovery _discovery = new();
	private readonly CancellationTokenSource _lifetime = new();
	private readonly DispatcherTimer _healthTimer;
	private readonly DispatcherTimer _networkDebounce;

	private readonly Dictionary<string, IdentifiedDevice> _mdnsIdentified = new();
	private readonly Dictionary<string, IdentifiedDevice> _manuallyIdentified = new();
	// One record per id, like the other sources
	private List<IdentifiedDevice> _fallbackIdentified = [];
	private List<Umbreld.UnverifiedDevice> _fallbackUnverified = [];
	private List<Umbreld.UpdateRequiredDevice> _fallbackUpdateRequired = [];
	private int _fallbackGeneration;
	// The first fallback scan, which the first search waits for like DNS-SD's candidates
	private bool _initialFallbackPending = true;
	private HashSet<string> _pendingNativeHosts = new(StringComparer.Ordinal);
	private CancellationTokenSource? _candidateIdentification;
	private CancellationTokenSource? _setupRefresh; // while the panel is open (PanelDidOpen)
	private readonly HashSet<string> _explicitlyClaimedDeviceIds = new();
	private bool _initialDiscoveryWindowElapsed;
	private bool _completedInitialReachabilityCheck;
	private readonly Dictionary<string, ProbeRecord> _probes = new();
	private readonly HashSet<string> _probesInFlight = new();
	// Saved Umbrels whose last failed probe found them answering under a new CA
	private readonly HashSet<string> _identityChanged = new();
	// Bumped by every verified answer from outside a probe and by Forget, so a probe that
	// started earlier drops its answer when it lands
	private readonly Dictionary<string, int> _probeGenerations = new();
	private readonly Dictionary<string, string> _connectionHosts = new();
	private readonly Dictionary<string, Umbreld.Session> _sessions = new();
	private readonly HashSet<string> _unavailableSessionIds = new();
	private readonly Dictionary<string, SambaAccess> _sambaAccess = new();
	// Memory only; umbreld stays the authority on the share login.
	private readonly Dictionary<string, (string Username, string Password)> _sambaCredentials = new();
	private readonly Dictionary<string, IReadOnlyList<Share>> _deviceShares = new();
	private readonly HashSet<string> _expired = new();
	private readonly HashSet<string> _connecting = new();
	private readonly HashSet<string> _disconnecting = new();
	private readonly HashSet<string> _mountsInProgress = new();
	private readonly HashSet<string> _foregroundMounts = new();
	private readonly HashSet<string> _sharingHome = new();
	// Drives this process mapped or gave a share row, with the host and share each maps
	// (see IsKnownDrive).
	private readonly Dictionary<string, List<Mounter.MountedShare>> _knownDrives = new();
	private readonly HashSet<string> _notifiedExpired = new();
	private bool _healthCheckRunning;
	private bool _disposed;

	private IReadOnlyList<Device> _devices = [];
	private IReadOnlyList<Umbreld.UnverifiedDevice> _unverifiedDevices = [];
	private IReadOnlySet<string> _retryingHosts = new HashSet<string>();
	private IReadOnlyList<Umbreld.UpdateRequiredDevice> _updateRequiredDevices = [];
	private Config.StorageIssue? _configStorageIssue;
	private bool _initialDiscoveryInProgress = true;
	private bool _scanning;
	private bool _showsAlertIcon;
	private bool _hasForegroundActivity;

	public AppState(Dispatcher dispatcher)
	{
		_dispatcher = dispatcher;
		var loaded = Config.Load();
		_config = loaded.Config;
		_configStorageIssue = loaded.Issue;

		foreach (var device in _config.SavedDevices.Values)
		{
			switch (SecretStore.ReadSession(device.Id))
			{
				case SecretStore.SessionReadResult.Found found:
					_sessions[device.Id] = found.Value;
					break;
				case SecretStore.SessionReadResult.Unavailable { CachedSession: { } cached }:
					_sessions[device.Id] = cached;
					_unavailableSessionIds.Add(device.Id);
					break;
				case SecretStore.SessionReadResult.Unavailable:
					_unavailableSessionIds.Add(device.Id);
					break;
			}
		}

		_healthTimer = new DispatcherTimer(DispatcherPriority.Background, dispatcher) { Interval = TimeSpan.FromSeconds(10) };
		_healthTimer.Tick += async (_, _) =>
		{
			_healthTimer.Interval = HealthInterval;
			await HealthCheckAsync();
		};
		_networkDebounce = new DispatcherTimer(DispatcherPriority.Background, dispatcher) { Interval = TimeSpan.FromSeconds(1) };
		_networkDebounce.Tick += async (_, _) =>
		{
			_networkDebounce.Stop();
			await RefreshAfterNetworkChangeAsync();
		};
		Rebuild();
	}

	// ── Published state ──

	public IReadOnlyList<Device> Devices
	{
		get => _devices;
		private set => SetProperty(ref _devices, value);
	}

	/// <summary>Current Umbrels at a fallback hostname that couldn't prove their identity.</summary>
	public IReadOnlyList<Umbreld.UnverifiedDevice> UnverifiedDevices
	{
		get => _unverifiedDevices;
		private set => SetProperty(ref _unverifiedDevices, value);
	}

	/// <summary>Hosts whose "Couldn't connect" card is asking again.</summary>
	public IReadOnlySet<string> RetryingHosts
	{
		get => _retryingHosts;
		private set => SetProperty(ref _retryingHosts, value);
	}

	public IReadOnlyList<Umbreld.UpdateRequiredDevice> UpdateRequiredDevices
	{
		get => _updateRequiredDevices;
		private set => SetProperty(ref _updateRequiredDevices, value);
	}

	public Config.StorageIssue? ConfigStorageIssue
	{
		get => _configStorageIssue;
		private set => SetProperty(ref _configStorageIssue, value);
	}

	/// <summary>True until the first discovery results are verified or the first window
	/// elapses with nothing to verify; drives "Searching…".</summary>
	public bool InitialDiscoveryInProgress
	{
		get => _initialDiscoveryInProgress;
		private set => SetProperty(ref _initialDiscoveryInProgress, value);
	}

	public bool Scanning
	{
		get => _scanning;
		private set => SetProperty(ref _scanning, value);
	}

	/// <summary>Saved devices exist, none is still unverified, and none is online and connected.</summary>
	public bool ShowsAlertIcon
	{
		get => _showsAlertIcon;
		private set => SetProperty(ref _showsAlertIcon, value);
	}

	/// <summary>Keeps the panel open while Windows may show its own dialogs for a connect or mount.</summary>
	public bool HasForegroundActivity
	{
		get => _hasForegroundActivity;
		private set => SetProperty(ref _hasForegroundActivity, value);
	}

	public event Action<string, string>? Notification;

	public IReadOnlyDictionary<string, SavedDevice> SavedDevices => _config.SavedDevices;

	public Device? Device(string id) => _devices.FirstOrDefault(device => device.Id == id);

	public string? ConnectionHost(string id) => _connectionHosts.TryGetValue(id, out var host) ? host : null;

	// The account picker loads avatar photos from the device, as on macOS.
	public Umbreld.Target? NativeTarget(string id) => TargetFor(id);

	public ConnectionState ConnectionState(string id)
	{
		if (_connecting.Contains(id)) return Umbrel.ConnectionState.Connecting;
		if (_disconnecting.Contains(id)) return Umbrel.ConnectionState.Disconnecting;
		if (_expired.Contains(id)) return Umbrel.ConnectionState.Expired;
		if (_sessions.ContainsKey(id)) return Umbrel.ConnectionState.Connected;
		if (_unavailableSessionIds.Contains(id)) return Umbrel.ConnectionState.Connecting;
		return Umbrel.ConnectionState.NotAuthenticated;
	}

	/// <summary>Owner accounts always have Samba; members only when umbreld reports it enabled.</summary>
	public bool CanUseFileSharing(string id)
	{
		if (!_sessions.TryGetValue(id, out var session)) return false;
		if (session.AccountId == "0") return true;
		return _sambaAccess.TryGetValue(id, out var access) && access.Enabled;
	}

	// Null means the shares haven't been fetched; an empty list is the server's "no shares"
	// answer and the only state that offers Share Home.
	public IReadOnlyList<Share>? DeviceShares(string id) => _deviceShares.TryGetValue(id, out var shares) ? shares : null;

	public bool IsSharingHome(string id) => _sharingHome.Contains(id);

	public bool IsUnsavedManualOnlyDevice(string id) =>
		!_config.SavedDevices.ContainsKey(id) && _manuallyIdentified.ContainsKey(id) && !_mdnsIdentified.ContainsKey(id)
		&& !_fallbackIdentified.Any(device => device.Id == id);

	public string? LastAccountId(string id) => _config.SavedDevices.TryGetValue(id, out var saved) ? saved.LastAccountId : null;

	// ── Lifecycle ──

	public void Start()
	{
		_discovery.Update += candidates => _dispatcher.BeginInvoke(() => HandleCandidates(candidates));
		_discovery.Start();
		_ = RefreshFallbackDiscoveryAsync();
		// Drives outlive the app. Recover the share list right away so a relaunch never
		// briefly offers Share Home before the first health check.
		foreach (var id in _sessions.Keys.ToList()) _ = MountAllInBackgroundAsync(id, silent: true);

		_ = _dispatcher.InvokeAsync(async () =>
		{
			await Task.Delay(250);
			ReloadUnavailableSessions();
			await ProbeSweepAsync();
			_completedInitialReachabilityCheck = true;
			PublishFallbackHints();
			Rebuild();
		});
		_ = _dispatcher.InvokeAsync(async () =>
		{
			// DNS-SD has no "finished" callback. Give initial results time to arrive; if a
			// candidate is already being verified, that work ends the searching state instead.
			await Task.Delay(2000);
			_initialDiscoveryWindowElapsed = true;
			FinishInitialDiscoveryIfIdle();
			PublishFallbackHints();
		});
		_healthTimer.Start();
		// Microsoft's recommended signal for connectivity changes, like the macOS path
		// monitor. NetworkChange.NetworkAddressChanged can fire in bursts every few
		// minutes when no address changed, and each event re-probes every saved device.
		NetworkInformation.NetworkStatusChanged += OnNetworkStatusChanged;
		SystemEvents.PowerModeChanged += OnPowerModeChanged;
	}

	public void Dispose()
	{
		if (_disposed) return;
		_disposed = true;
		NetworkInformation.NetworkStatusChanged -= OnNetworkStatusChanged;
		SystemEvents.PowerModeChanged -= OnPowerModeChanged;
		_healthTimer.Stop();
		_networkDebounce.Stop();
		_lifetime.Cancel();
		_candidateIdentification?.Cancel();
		_setupRefresh?.Cancel();
		_discovery.Dispose();
	}

	// Raised off the UI thread, often several times for one change.
	private void OnNetworkStatusChanged(object sender) =>
		_dispatcher.BeginInvoke(() =>
		{
			_networkDebounce.Stop();
			_networkDebounce.Start();
		});

	private void OnPowerModeChanged(object sender, PowerModeChangedEventArgs e)
	{
		if (e.Mode != PowerModes.Resume) return;
		_ = _dispatcher.InvokeAsync(async () =>
		{
			await Task.Delay(5000);
			await HealthCheckAsync();
		});
	}

	// Only the installed (packaged) app turns on run at startup by itself. An unpackaged
	// build (dev or test) leaves the choice to the tray menu: its Run-key entry would
	// keep launching that build at sign-in after the packaged app is installed, and the
	// packaged app reads the same settings file, so it would skip its own default.
	public Task RegisterLaunchAtLoginByDefaultIfNeededAsync()
	{
		if (!StartupManager.IsPackaged) return Task.CompletedTask;
		if (AppSettings.Load().LaunchAtLoginDefaultApplied) return Task.CompletedTask;
		return _dispatcher.InvokeAsync(async () =>
		{
			var status = await StartupManager.StatusAsync();
			if (status is LaunchAtLoginStatus.Enabled or LaunchAtLoginStatus.RequiresApproval)
			{
				MarkLaunchAtLoginDefaultApplied();
				return;
			}
			if (status == LaunchAtLoginStatus.Unavailable) return;
			// Opt the user in once; a later opt-out is never overridden.
			await StartupManager.SetEnabledAsync(true);
			MarkLaunchAtLoginDefaultApplied();
		}).Task.Unwrap();
	}

	private static void MarkLaunchAtLoginDefaultApplied()
	{
		var settings = AppSettings.Load();
		settings.LaunchAtLoginDefaultApplied = true;
		settings.Save();
	}

	// ── Discovery ──

	// A device the user picked for first sign-in keeps validating with its new pin before
	// a successful login saves it.
	private HashSet<string> KnownDeviceIds() =>
		new(_config.SavedDevices.Keys.Concat(_explicitlyClaimedDeviceIds), StringComparer.Ordinal);

	private void HandleCandidates(IReadOnlyList<Candidate> candidates)
	{
		_candidateIdentification?.Cancel();
		_pendingNativeHosts = candidates.Select(candidate => Mounter.NormalizeHost(candidate.Host)).ToHashSet(StringComparer.Ordinal);
		if (candidates.Count == 0)
		{
			// Discovery.Stop() publishes an empty list too, so this must end "Searching…".
			_candidateIdentification = null;
			_mdnsIdentified.Clear();
			FinishInitialDiscoveryIfIdle();
			PublishFallbackHints();
			Rebuild();
			return;
		}
		PublishFallbackHints();
		var cts = CancellationTokenSource.CreateLinkedTokenSource(_lifetime.Token);
		_candidateIdentification = cts;
		_ = IdentifyCandidatesAsync(candidates, cts);
	}

	private async Task IdentifyCandidatesAsync(IReadOnlyList<Candidate> candidates, CancellationTokenSource cts)
	{
		IReadOnlyList<IdentifiedDevice> identified;
		try
		{
			identified = await Umbreld.IdentifyAsync(candidates, KnownDeviceIds(), cts.Token);
		}
		catch (OperationCanceledException)
		{
			return;
		}
		catch (Exception)
		{
			// Still finish the pass: a stuck identification would keep "Searching…" up.
			identified = [];
		}
		if (cts.IsCancellationRequested) return;

		if (ReferenceEquals(_candidateIdentification, cts)) _candidateIdentification = null;
		_pendingNativeHosts = new HashSet<string>(StringComparer.Ordinal);
		_mdnsIdentified.Clear();
		// Keyed by id, so records for one id under different certificates collapse to the first.
		foreach (var device in identified)
		{
			if (!_mdnsIdentified.TryAdd(device.Id, device)) continue;
			if (_config.SavedDevices.ContainsKey(device.Id))
			{
				TryUpdateConfig(device.Id, saved => saved.MergeVerifiedDiscovery(device));
			}
		}
		FinishInitialDiscoveryIfIdle();
		PublishFallbackHints();
		Rebuild();
	}

	// Older umbrelOS releases don't advertise the native service, and some networks filter
	// DNS-SD browsing. Current Umbrels at the common hostnames are identified like DNS-SD
	// candidates. The rest stay separate from trusted devices: they can offer a retry or a
	// browser link, but never enter trust or persistence.
	private async Task RefreshFallbackDiscoveryAsync()
	{
		var generation = ++_fallbackGeneration;
		RetryingHosts = new HashSet<string>();
		Umbreld.FallbackDiscoveryResult result;
		try
		{
			result = await Umbreld.DiscoverFallbackHostsAsync(
				KnownDeviceIds(),
				// Older Umbrels show as soon as their version answers
				updateRequired => _dispatcher.InvokeAsync(() => ShowFallbackUpdateHints(updateRequired, generation)).Task,
				_lifetime.Token);
		}
		catch (OperationCanceledException) when (_lifetime.IsCancellationRequested)
		{
			return;
		}
		catch (Exception)
		{
			// Still finish the scan: a failed one would keep "Searching…" up.
			result = new Umbreld.FallbackDiscoveryResult([], [], []);
		}
		// Any finished scan ends the first search, so network changes while Wi-Fi and
		// Tailscale settle at sign-in can't keep it searching.
		_initialFallbackPending = false;
		if (generation != _fallbackGeneration)
		{
			FinishInitialDiscoveryIfIdle();
			return;
		}
		AdoptFallbackDevices(result.Devices);
		_fallbackUnverified = result.Unverified.ToList();
		_fallbackUpdateRequired = result.UpdateRequired.ToList();
		FinishInitialDiscoveryIfIdle();
		PublishFallbackHints();
		Rebuild();
	}

	private void ShowFallbackUpdateHints(IReadOnlyList<Umbreld.UpdateRequiredDevice> updateRequired, int generation)
	{
		if (generation != _fallbackGeneration) return;
		_fallbackUpdateRequired = updateRequired.ToList();
		PublishFallbackHints();
	}

	// Unsaved Umbrels found at the common hostnames become candidates. Saved ones were
	// proven against their pin, so they join the normal reachability probes instead, which
	// keep their online state current after this one-off scan. The device list is keyed by
	// id, so the scan's records for one id under different certificates collapse to the first.
	private void AdoptFallbackDevices(IReadOnlyList<IdentifiedDevice> devices)
	{
		var seenIds = new HashSet<string>(StringComparer.Ordinal);
		_fallbackIdentified = devices
			.Where(device => IsFallbackCandidate(device) && seenIds.Add(device.Id))
			.ToList();
		foreach (var device in devices.Where(IsSavedFallbackRoute)) AdoptSavedFallbackDevice(device);
	}

	// A scan identifies against the saved ids it started with, and an Umbrel can be saved or
	// forgotten before it lands. Only a record proven with the saved pin is a saved Umbrel's
	// route, and only one proven with its own candidate CA (or the pin of one the user just
	// picked) is a candidate. Anything else waits for the next scan.
	private bool IsSavedFallbackRoute(IdentifiedDevice device) =>
		_config.SavedDevices.ContainsKey(device.Id) && device.ProvedWithSavedPin;

	private bool IsFallbackCandidate(IdentifiedDevice device) =>
		!_config.SavedDevices.ContainsKey(device.Id)
		&& (!device.ProvedWithSavedPin || _explicitlyClaimedDeviceIds.Contains(device.Id));

	// The scan proved this route against the saved pin. Remember it, as Connect by address
	// does, so probes and connections reach the Umbrel when DNS-SD misses it.
	private void AdoptSavedFallbackDevice(IdentifiedDevice device)
	{
		TryUpdateConfig(device.Id, saved => saved.RememberConnectionCandidates([device.Host, .. device.Addresses]));
		RecordVerifiedRoute(device.Id, device.Host, device.DiscoveryInfo);
	}

	// The first search ends once DNS-SD has had its window and both its candidates and the
	// first fallback scan have finished verifying.
	private void FinishInitialDiscoveryIfIdle()
	{
		if (!_initialDiscoveryWindowElapsed || _candidateIdentification is not null || _initialFallbackPending) return;
		InitialDiscoveryInProgress = false;
	}

	private void InvalidateFallbackDiscovery()
	{
		_fallbackGeneration++;
		RetryingHosts = new HashSet<string>();
		_fallbackIdentified = [];
		_fallbackUnverified = [];
		_fallbackUpdateRequired = [];
		UnverifiedDevices = [];
		UpdateRequiredDevices = [];
		Rebuild();
	}

	private void PublishFallbackHints()
	{
		if (InitialDiscoveryInProgress || !_completedInitialReachabilityCheck || Scanning)
		{
			if (UnverifiedDevices.Count > 0) UnverifiedDevices = [];
			if (UpdateRequiredDevices.Count > 0) UpdateRequiredDevices = [];
			return;
		}
		// Every verified route suppresses a hint, including a device's DNS-SD name when a
		// manually entered address is the one rendered, so it can't look like a second Umbrel.
		var now = DateTimeOffset.UtcNow;
		var saved = _config.SavedDevices;
		var verifiedHosts = _mdnsIdentified.Values.Concat(_fallbackIdentified).Concat(_manuallyIdentified.Values)
			.SelectMany(device => new[] { device.Host, device.DiscoveryHost }.Concat(device.Addresses))
			.Concat(_probes
				.Where(pair => pair.Value.Identity is not null && pair.Value.IsFresh(now) && saved.ContainsKey(pair.Key))
				.SelectMany(pair => (pair.Value.Host is { } host ? new[] { host } : []).Concat(saved[pair.Key].ConnectionHosts)))
			.Select(Mounter.NormalizeHost)
			.ToHashSet(StringComparer.Ordinal);
		// A failed name that resolves to a verified Umbrel's address is that Umbrel by another name.
		_fallbackUnverified.RemoveAll(device =>
			new[] { device.Host }.Concat(device.Addresses).Any(host => verifiedHosts.Contains(Mounter.NormalizeHost(host))));
		_fallbackUpdateRequired.RemoveAll(device => verifiedHosts.Contains(Mounter.NormalizeHost(device.Host)));
		var unverified = VisibleHints(_fallbackUnverified, UnverifiedDevices, device => device.Host);
		var updateRequired = VisibleHints(_fallbackUpdateRequired, UpdateRequiredDevices, device => device.Host);
		if (!unverified.SequenceEqual(UnverifiedDevices)) UnverifiedDevices = unverified;
		if (!updateRequired.SequenceEqual(UpdateRequiredDevices)) UpdateRequiredDevices = updateRequired;
	}

	// One card per host, hidden while its DNS-SD candidate is being verified unless it's
	// already showing.
	private List<T> VisibleHints<T>(IEnumerable<T> hints, IEnumerable<T> shown, Func<T, string> host)
	{
		var previouslyVisible = shown.Select(hint => Mounter.NormalizeHost(host(hint))).ToHashSet(StringComparer.Ordinal);
		return hints
			.DistinctBy(hint => Mounter.NormalizeHost(host(hint)))
			.Where(hint =>
			{
				var normalized = Mounter.NormalizeHost(host(hint));
				return !_pendingNativeHosts.Contains(normalized) || previouslyVisible.Contains(normalized);
			})
			.OrderBy(host, StringComparer.Ordinal)
			.ToList();
	}

	// Try again on a "Couldn't connect" card. A device that now proves its identity replaces
	// the card; otherwise the card stays, with the latest reason. An answer that arrives after
	// a rescan or network change belongs to the old scan and is dropped.
	public async Task RetryAsync(Umbreld.UnverifiedDevice device)
	{
		if (RetryingHosts.Contains(device.Host)) return;
		RetryingHosts = new HashSet<string>(RetryingHosts) { device.Host };
		var generation = _fallbackGeneration;
		Umbreld.HostIdentification identification;
		try
		{
			identification = await Umbreld.IdentifyAsync(device, KnownDeviceIds(), _lifetime.Token);
		}
		catch (OperationCanceledException)
		{
			return;
		}
		if (generation != _fallbackGeneration) return;
		RetryingHosts = RetryingHosts.Where(host => host != device.Host).ToHashSet();
		_fallbackUnverified.RemoveAll(unverified => unverified.Host == device.Host);
		switch (identification)
		{
			case Umbreld.HostIdentification.Device found when IsSavedFallbackRoute(found.Value):
				AdoptSavedFallbackDevice(found.Value);
				break;
			case Umbreld.HostIdentification.Device found when IsFallbackCandidate(found.Value):
				_fallbackIdentified.RemoveAll(existing => existing.Id == found.Value.Id);
				_fallbackIdentified.Add(found.Value);
				break;
			case Umbreld.HostIdentification.Unverified unverified:
				_fallbackUnverified.Add(unverified.Value);
				break;
			// A saved Umbrel whose identity changed is left to its own handling; trying again
			// can't fix it.
		}
		PublishFallbackHints();
		Rebuild();
	}

	public async Task RescanAsync()
	{
		if (Scanning) return;
		Scanning = true;
		try
		{
			InvalidateFallbackDiscovery();
			_discovery.Stop();
			_discovery.Start();
			// A slow Umbrel can keep the fallback scan busy for a while. Its results publish
			// whenever they land, and the generation check drops a superseded scan.
			_ = RefreshFallbackDiscoveryAsync();
			var probes = ProbeSweepAsync(force: true);
			// Hold the scanning state long enough for browse results to arrive.
			await Task.Delay(2000);
			await probes;
		}
		finally
		{
			Scanning = false;
			PublishFallbackHints();
		}
	}

	// ── Reachability probes ──

	/// <summary>Probe saved devices no verified discovery result already represents.
	/// force skips the cooldown for explicit refreshes; in-flight probes still dedupe.</summary>
	public Task ProbeSweepAsync(bool force = false) => ProbeDevicesAsync(ProbeTargetIds(), force);

	// Refresh liveness whenever the panel opens. An Umbrel set up in a browser advertises
	// nothing new afterwards, so while the panel is open, Umbrels still waiting for setup
	// are also asked again every few seconds. Reopening the panel after setup then moves
	// the card and its page on to sign-in.
	public void PanelDidOpen()
	{
		_ = ProbeSweepAsync();
		_setupRefresh?.Cancel();
		_setupRefresh = new CancellationTokenSource();
		_ = RefreshDevicesAwaitingSetupWhileOpenAsync(_setupRefresh.Token);
	}

	public void PanelDidClose()
	{
		_setupRefresh?.Cancel();
		_setupRefresh = null;
	}

	private async Task RefreshDevicesAwaitingSetupWhileOpenAsync(CancellationToken ct)
	{
		try
		{
			while (true)
			{
				await RefreshDevicesAwaitingSetupAsync(ct);
				await Task.Delay(TimeSpan.FromSeconds(3), ct);
			}
		}
		catch (OperationCanceledException) when (ct.IsCancellationRequested)
		{
		}
	}

	private async Task RefreshDevicesAwaitingSetupAsync(CancellationToken ct)
	{
		var saved = _config.SavedDevices;
		var awaitingSetup = _mdnsIdentified.Values.Concat(_fallbackIdentified).Concat(_manuallyIdentified.Values)
			.Where(device => !device.Onboarded && !saved.ContainsKey(device.Id))
			.ToList();
		if (awaitingSetup.Count == 0) return;
		var results = await Task.WhenAll(awaitingSetup.Select(async device =>
			(Asked: device, Current: await Umbreld.ReidentifyAsync(device, ct))));
		var finished = results.Where(result => result.Current is { Onboarded: true }).ToList();
		if (finished.Count == 0) return;
		// Discovery or a manual connection may have replaced a record while it was being
		// asked. Update only the exact record that was checked and leave a replacement to
		// the next check.
		foreach (var (asked, current) in finished)
		{
			if (_mdnsIdentified.TryGetValue(asked.Id, out var mdns) && ReferenceEquals(mdns, asked))
			{
				_mdnsIdentified[asked.Id] = current!;
			}
			var fallback = _fallbackIdentified.FindIndex(device => ReferenceEquals(device, asked));
			if (fallback >= 0) _fallbackIdentified[fallback] = current!;
			if (_manuallyIdentified.TryGetValue(asked.Id, out var manual) && ReferenceEquals(manual, asked))
			{
				_manuallyIdentified[asked.Id] = current!;
			}
		}
		Rebuild();
	}

	// Saved devices need their own probes when mDNS can't see them (other VLANs,
	// multicast-filtering networks, Tailscale).
	private HashSet<string> ProbeTargetIds()
	{
		var ids = new HashSet<string>(_config.SavedDevices.Keys, StringComparer.Ordinal);
		ids.ExceptWith(_mdnsIdentified.Keys);
		ids.ExceptWith(_manuallyIdentified.Keys);
		return ids;
	}

	private async Task ProbeDevicesAsync(IEnumerable<string> ids, bool force)
	{
		var now = DateTimeOffset.UtcNow;
		var saved = _config.SavedDevices;
		var due = ids
			.Where(id => saved.ContainsKey(id) && !_probesInFlight.Contains(id))
			.Where(id => force || !_probes.TryGetValue(id, out var probe) || now - probe.CheckedAt > ProbeCooldown)
			.ToList();
		if (due.Count == 0) return;
		_probesInFlight.UnionWith(due);
		await Task.WhenAll(due.Select(id => ProbeDeviceAsync(saved[id])));
	}

	private async Task ProbeDeviceAsync(SavedDevice saved)
	{
		var generation = _probeGenerations.GetValueOrDefault(saved.Id);
		(string Host, Umbreld.DiscoveryInfo Identity)? result = null;
		var identityChanged = false;
		try
		{
			var target = saved.NativeTarget;
			// Something answered but didn't prove the pin: either this Umbrel with a new
			// identity or another server, and each needs something different from the user.
			// When nothing answered at all, there's nothing more to ask.
			var answeredWithoutPin = false;
			try
			{
				var host = await Umbreld.ResolvedHostAsync(target, _lifetime.Token);
				var identity = await Umbreld.IdentifyAsync(host, target.DeviceId, _lifetime.Token);
				if (identity is not null) result = (host, identity);
				// A cached route that verified before and doesn't now
				else answeredWithoutPin = true;
			}
			catch (OperationCanceledException) when (_lifetime.IsCancellationRequested)
			{
				throw;
			}
			catch (Exception error) when (Umbreld.IsIdentityChange(error))
			{
				answeredWithoutPin = true;
			}
			catch (Exception)
			{
			}
			if (answeredWithoutPin) identityChanged = await Umbreld.IdentityChangedAsync(target, _lifetime.Token);
		}
		catch (OperationCanceledException)
		{
			_probesInFlight.Remove(saved.Id);
			return;
		}
		// A newer answer, or Forget, came in while this probe ran.
		if (_probeGenerations.GetValueOrDefault(saved.Id) != generation || !_config.SavedDevices.ContainsKey(saved.Id))
		{
			_probesInFlight.Remove(saved.Id);
			return;
		}
		if (identityChanged) _identityChanged.Add(saved.Id);
		else _identityChanged.Remove(saved.Id);
		ProbeCompleted(saved.Id, result?.Host, result?.Identity);
	}

	private void ProbeCompleted(string id, string? host, Umbreld.DiscoveryInfo? identity)
	{
		_probesInFlight.Remove(id);
		RecordProbe(id, host, identity);
	}

	// A verified answer from outside a probe: the hostname scan, Connect by address or sign-in.
	// It's newer than any probe still running, which drops its own answer when it lands.
	private void RecordVerifiedRoute(string id, string host, Umbreld.DiscoveryInfo identity)
	{
		SupersedeProbes(id);
		RecordProbe(id, host, identity);
	}

	private void SupersedeProbes(string id) => _probeGenerations[id] = _probeGenerations.GetValueOrDefault(id) + 1;

	private void RecordProbe(string id, string? host, Umbreld.DiscoveryInfo? identity)
	{
		_probes[id] = new ProbeRecord(host, identity, DateTimeOffset.UtcNow);
		if (identity is not null) _identityChanged.Remove(id);
		if (identity is not null && host is not null) _connectionHosts[id] = host;
		else _connectionHosts.Remove(id);
		PublishFallbackHints();
		Rebuild();
	}

	private static async Task<(string Host, Umbreld.DiscoveryInfo Identity)?> FirstReachableEndpointAsync(
		Umbreld.Target target,
		CancellationToken ct)
	{
		try
		{
			var host = await Umbreld.ResolvedHostAsync(target, ct);
			var identity = await Umbreld.IdentifyAsync(host, target.DeviceId, ct);
			return identity is null ? null : (host, identity);
		}
		catch (OperationCanceledException) when (ct.IsCancellationRequested)
		{
			throw;
		}
		catch (Exception)
		{
			return null;
		}
	}

	// A network event says a route changed, not whether an Umbrel is reachable. Keep the
	// UI stable while old probes finish, then drop every cached endpoint and verify each
	// saved device again so drives follow the verified route.
	private async Task RefreshAfterNetworkChangeAsync()
	{
		// Don't restart the DNS-SD browse: that would blank unsaved devices during route churn.
		// Likewise the last fallback snapshot stays until the next one lands. Only the newest
		// scan publishes, so a slow one isn't awaited here.
		_ = RefreshFallbackDiscoveryAsync();
		var saved = _config.SavedDevices.Values.ToList();
		var ids = saved.Select(device => device.Id).ToHashSet(StringComparer.Ordinal);
		if (ids.Count == 0) return;
		while (_probesInFlight.Overlaps(ids)) await Task.Delay(100);
		foreach (var device in saved) Umbreld.InvalidateResolvedHost(device.NativeTarget);
		await ProbeDevicesAsync(ids, force: true);
		foreach (var id in ids.Where(_sessions.ContainsKey)) _ = MountAllInBackgroundAsync(id, silent: true);
	}

	// ── Health ──
	// Runs every 60 s and 5 s after resume. A probe sweep refreshes liveness first, then for
	// each saved online device: renew access, confirm it server-side, and reconcile drives.
	// The share login is refetched every cycle and compared to the one the drives use, so a
	// change on the Umbrel is picked up within a minute while the app is running.

	private async Task HealthCheckAsync()
	{
		if (_healthCheckRunning) return;
		_healthCheckRunning = true;
		try
		{
			ReloadUnavailableSessions();
			await ProbeSweepAsync();

			foreach (var device in _devices.Where(device => device.Saved && device.Online).ToList())
			{
				if (!_sessions.TryGetValue(device.Id, out var session)) continue;
				var target = TargetFor(device.Id);
				if (target is null) continue;
				Umbreld.UserInfo? validatedUser = null;
				IReadOnlyList<string>? refreshedAddresses = null;
				try
				{
					var renewed = await Umbreld.RenewSessionAsync(target, session, _lifetime.Token);
					if (!IsCurrentSession(session, device.Id)) continue;
					// Access can be unexpired locally but revoked on the server. This cheap
					// authenticated read keeps "Connected" tied to server truth every cycle.
					var addressesTask = AddressesOrNullAsync(target, renewed);
					validatedUser = await Umbreld.UserAsync(target, renewed, _lifetime.Token);
					refreshedAddresses = await addressesTask;
					if (!IsCurrentSession(session, device.Id)) continue;
					// The shared coordinator already persisted the authoritative session; only
					// refresh the memory copy, never write an older token back.
					switch (SecretStore.ReadSession(device.Id))
					{
						case SecretStore.SessionReadResult.Found found when found.Value.BelongsToSameLogin(session):
							_sessions[device.Id] = found.Value;
							_unavailableSessionIds.Remove(device.Id);
							break;
						case SecretStore.SessionReadResult.Found:
							continue;
						case SecretStore.SessionReadResult.Unavailable:
							_sessions[device.Id] = renewed;
							_unavailableSessionIds.Add(device.Id);
							break;
						default:
							_sessions[device.Id] = renewed;
							break;
					}
					_expired.Remove(device.Id);
					_notifiedExpired.Remove(device.Id);
				}
				catch (OperationCanceledException) when (_lifetime.IsCancellationRequested)
				{
					return;
				}
				catch (UmbreldException error) when (error.IsAuthError)
				{
					await SessionExpiredAsync(device.Id, session);
					continue;
				}
				catch (Exception error) when (Umbreld.IsIdentityChange(error))
				{
					// The Umbrel now refuses its pin, as after a certificate reset. Its DNS-SD record
					// was verified before that and no longer shows it's online, so drop it and probe
					// the saved routes, which tells a new identity apart from another server.
					_mdnsIdentified.Remove(device.Id);
					Rebuild();
					await ProbeDevicesAsync([device.Id], force: true);
					continue;
				}
				catch (Exception)
				{
					// Treated as a network blip; retried next cycle.
				}
				if (!IsCurrentSession(session, device.Id)) continue;

				await MountAllAsync(device.Id, silent: true, validatedUser);

				if (validatedUser is not null && IsCurrentSession(session, device.Id))
				{
					try
					{
						_connectionHosts[device.Id] = await Umbreld.ResolvedHostAsync(target, _lifetime.Token);
					}
					catch (OperationCanceledException) when (_lifetime.IsCancellationRequested)
					{
						return;
					}
					catch (Exception)
					{
						_connectionHosts.Remove(device.Id);
					}
					PersistAccountProfile(device.Id, validatedUser, refreshedAddresses);
				}
			}
		}
		finally
		{
			_healthCheckRunning = false;
			Rebuild();
		}
	}

	private async Task<IReadOnlyList<string>?> AddressesOrNullAsync(Umbreld.Target target, Umbreld.Session session)
	{
		try
		{
			return await Umbreld.IpAddressesAsync(target, session, _lifetime.Token);
		}
		catch (Exception)
		{
			return null;
		}
	}

	private void ReloadUnavailableSessions()
	{
		if (_unavailableSessionIds.Count == 0) return;
		foreach (var id in _unavailableSessionIds.ToList())
		{
			switch (SecretStore.ReadSession(id))
			{
				case SecretStore.SessionReadResult.Found found:
					_sessions[id] = found.Value;
					_unavailableSessionIds.Remove(id);
					break;
				case SecretStore.SessionReadResult.Missing or SecretStore.SessionReadResult.Invalid:
					_sessions.Remove(id);
					_unavailableSessionIds.Remove(id);
					break;
				case SecretStore.SessionReadResult.Unavailable { CachedSession: { } cached }:
					_sessions[id] = cached;
					break;
			}
		}
		Rebuild();
	}

	// ── Session currency and expiry ──

	// Background work that awaited I/O must not act for a login that was replaced, signed
	// out, or is being disconnected in the meantime.
	private bool IsCurrentSession(Umbreld.Session expected, string id) =>
		!_disconnecting.Contains(id)
		&& _sessions.TryGetValue(id, out var current)
		&& current.BelongsToSameLogin(expected);

	private async Task SessionExpiredAsync(string id, Umbreld.Session session)
	{
		// A 401 for a login that is gone or being disconnected isn't an expiry, and must not
		// delete a newer login's stored session.
		if (!IsCurrentSession(session, id)) return;
		ClearSession(id);
		_expired.Add(id);
		Rebuild();
		try
		{
			await UnmountAllSharesAsync(id);
		}
		catch (Exception error)
		{
			// The session can't stay active, but a busy drive is left mapped rather than forced.
			Trace.TraceWarning("Expired-session unmount failed: {0}", FileLog.Describe(error));
		}
		if (_notifiedExpired.Add(id))
		{
			var name = Device(id)?.DisplayName ?? _config.SavedDevices.GetValueOrDefault(id)?.DisplayName ?? "your device";
			Notification?.Invoke("Session expired", $"Your login session for {name} has expired. Open Umbrel to reconnect.");
		}
		Rebuild();
	}

	// The memory caches and the secret store stay in sync.
	private bool StoreSession(Umbreld.Session session, string id)
	{
		if (!SecretStore.SetSession(session, id)) return false;
		_sessions[id] = session;
		_unavailableSessionIds.Remove(id);
		_sambaAccess.Remove(id);
		_sambaCredentials.Remove(id);
		_expired.Remove(id);
		_notifiedExpired.Remove(id);
		return true;
	}

	private void ClearSession(string id)
	{
		_sessions.Remove(id);
		_connectionHosts.Remove(id);
		_unavailableSessionIds.Remove(id);
		_sambaAccess.Remove(id);
		_sambaCredentials.Remove(id);
		_expired.Remove(id);
		SecretStore.DeleteSession(id);
	}

	// ── Sign in / out ──

	/// <summary>Verify identity for the selected card, then load its accounts for the picker.</summary>
	public async Task<IReadOnlyList<Umbreld.Account>> PrepareToSignInAsync(string id, CancellationToken ct)
	{
		Umbreld.Target target;
		if (_config.SavedDevices.TryGetValue(id, out var saved))
		{
			target = saved.NativeTarget;
			// Like macOS, re-resolve the route only after identity recovery; accounts load on
			// every page open and must not reset the verified connection host.
			if (await Umbreld.PrepareSavedDeviceForSignInAsync(target, ct))
			{
				var result = await FirstReachableEndpointAsync(target, ct) ?? throw new DeviceIdentityUnavailableException();
				RecordVerifiedRoute(id, result.Host, result.Identity);
			}
		}
		else
		{
			var discovered = IdentifiedCandidate(id) ?? throw new DeviceIdentityUnavailableException();
			if (!_explicitlyClaimedDeviceIds.Contains(id))
			{
				await Umbreld.ClaimLocalHttpsIdentityAsync(discovered, ct);
				_explicitlyClaimedDeviceIds.Add(id);
			}
			target = new Umbreld.Target(id, new[] { discovered.Host }.Concat(discovered.Addresses));
		}
		return await Umbreld.ListAccountsAsync(target, ct);
	}

	public async Task ConnectAsync(string id, Umbreld.Account? account, string password, string? totpToken, CancellationToken ct)
	{
		if (_connecting.Contains(id)) return;
		var target = TargetFor(id) ?? throw new DeviceIdentityUnavailableException();
		var userId = account?.UserId ?? "0";
		_connecting.Add(id);
		Rebuild();
		try
		{
			// One account is active per device and Windows allows one share login per server,
			// so drives made under another account go first. Signing back into the same
			// account keeps them: a background unmount fails while an Explorer window shows
			// the drive. A real switch asks through Windows' open-files prompt, as Disconnect does.
			if (LastAccountId(id) != userId) await UnmountAllSharesAsync(id, confirmWithUser: true);
			ct.ThrowIfCancellationRequested();

			var session = await Umbreld.LoginAsync(target, userId, password, totpToken, ct);
			// The user may have left or forgotten the device while the request was in flight.
			// Never let that completed request restore local state afterwards.
			if (ct.IsCancellationRequested)
			{
				await LogoutQuietlyAsync(target, session);
				ct.ThrowIfCancellationRequested();
			}
			if (!StoreSession(session, id))
			{
				await LogoutQuietlyAsync(target, session);
				throw new InvalidOperationException("Couldn’t securely save your login. Please try again.");
			}

			string? host = null;
			try
			{
				host = await Umbreld.ResolvedHostAsync(target, ct);
			}
			catch (Exception)
			{
			}
			if (host is null) _connectionHosts.Remove(id);
			else _connectionHosts[id] = host;

			var live = IdentifiedCandidate(id);
			var existing = _config.SavedDevices.GetValueOrDefault(id);
			var saved = existing ?? new SavedDevice
			{
				Id = id,
				Name = live?.Name ?? host ?? id,
				Host = live?.Host ?? host ?? "",
				Addresses = live?.Addresses ?? [],
				Model = live?.Model,
			};
			if (live is not null) saved = saved.MergeVerifiedDiscovery(live);
			if (account is not null)
			{
				saved = saved.SaveAccountProfile(
					session.AccountId, account.Name, account.Wallpaper.Id, account.Wallpaper.BrandColorHsl,
					session.AccountId == "0" ? "owner" : "member");
			}
			try
			{
				_config.Save(saved);
				_explicitlyClaimedDeviceIds.Remove(id);
				_identityChanged.Remove(id);
			}
			catch (Config.StorageException error)
			{
				ClearSession(id);
				await LogoutQuietlyAsync(target, session);
				ConfigStorageIssue = error.Issue;
				throw;
			}
			// Once saved, normal reachability probes own the device's online state.
			if (_manuallyIdentified.Remove(id, out var manual))
			{
				RecordVerifiedRoute(id, _connectionHosts.GetValueOrDefault(id) ?? manual.Host, manual.DiscoveryInfo);
			}
			if (_fallbackIdentified.Find(device => device.Id == id) is { } fallback)
			{
				_fallbackIdentified.RemoveAll(device => device.Id == id);
				RecordVerifiedRoute(id, _connectionHosts.GetValueOrDefault(id) ?? fallback.Host, fallback.DiscoveryInfo);
			}

			// Post-login work is best-effort and doesn't hold up the "Connected" state.
			_ = SyncAccountProfileAsync(id, target, session);
			_ = MountAllInBackgroundAsync(id, silent: false);
		}
		finally
		{
			_connecting.Remove(id);
			Rebuild();
		}
	}

	private static async Task LogoutQuietlyAsync(Umbreld.Target target, Umbreld.Session session)
	{
		try
		{
			await Umbreld.LogoutAsync(target, session, CancellationToken.None);
		}
		catch (Exception)
		{
		}
	}

	private async Task SyncAccountProfileAsync(string id, Umbreld.Target target, Umbreld.Session session)
	{
		var addressesTask = AddressesOrNullAsync(target, session);
		Umbreld.UserInfo info;
		try
		{
			info = await Umbreld.UserAsync(target, session, _lifetime.Token);
		}
		catch (Exception)
		{
			return;
		}
		if (!IsCurrentSession(session, id)) return;
		_sambaAccess[id] = new SambaAccess(info.UserId, info.SambaEnabled, info.SambaUsername, info.HomePath);
		PersistAccountProfile(id, info, await addressesTask);
		Rebuild();
	}

	private void PersistAccountProfile(string id, Umbreld.UserInfo info, IReadOnlyList<string>? addresses) =>
		TryUpdateConfig(id, saved =>
		{
			var updated = saved.SaveAccountProfile(info.UserId, info.Name, info.Wallpaper.Id, info.Wallpaper.BrandColorHsl, info.Role);
			return addresses is null ? updated : updated.ReplaceAvailableAddresses(addresses);
		});

	// Unmount everything and drop the session, but keep the device saved. The transitional
	// state shows immediately; shares drain row by row as they unmount.
	public async Task DisconnectAsync(string id)
	{
		if (_disconnecting.Contains(id)) return;
		_disconnecting.Add(id);
		Rebuild();
		try
		{
			// Keep the session until Windows has released every drive. `_disconnecting` makes
			// background work treat this login as stale meanwhile, without claiming a failed
			// disconnect succeeded.
			var session = _sessions.GetValueOrDefault(id);
			await UnmountAllSharesAsync(id, confirmWithUser: true);
			ClearSession(id);
			if (session is not null && TargetFor(id) is { } target)
			{
				try
				{
					await Umbreld.LogoutAsync(target, session, _lifetime.Token);
				}
				catch (Exception)
				{
				}
			}
			_deviceShares.Remove(id);
		}
		finally
		{
			_disconnecting.Remove(id);
			Rebuild();
		}
	}

	public async Task ForgetAsync(string id)
	{
		await DisconnectAsync(id);
		Umbreld.ForgetLocalHttpsIdentity(id);
		try
		{
			_config.Remove(id);
		}
		catch (Config.StorageException error)
		{
			ConfigStorageIssue = error.Issue;
		}
		_probes.Remove(id);
		SupersedeProbes(id);
		_identityChanged.Remove(id);
		_connectionHosts.Remove(id);
		_manuallyIdentified.Remove(id);
		_explicitlyClaimedDeviceIds.Remove(id);
		Rebuild();
	}

	// For a saved Umbrel with a new identity, once the user confirms they reset it: forget
	// it, then look again, so it shows up as it is now and is signed in to like a new one.
	public async Task ReconnectAsync(string id)
	{
		await ForgetAsync(id);
		_ = RescanWhenIdleAsync();
	}

	// A scan already running took its saved ids before the Umbrel was forgotten, so it would
	// drop it; look again once that scan ends.
	private async Task RescanWhenIdleAsync()
	{
		while (Scanning) await Task.Delay(100);
		await RescanAsync();
	}

	public void DismissConfigStorageIssue() => ConfigStorageIssue = null;

	// ── Connect by address ──

	// A navigation flow, not another discovery source: a verified device can drive sign-in
	// and later become a saved card; an Umbrel that couldn't prove itself offers another try,
	// and a legacy endpoint only shows an update message.
	public async Task<AddressConnectionResult> ConnectByAddressAsync(string input, CancellationToken ct)
	{
		var result = await Umbreld.DiscoverManuallyAsync(input, KnownDeviceIds(), ct);
		ct.ThrowIfCancellationRequested();
		switch (result)
		{
			case Umbreld.ManualDiscoveryResult.Device found:
				var device = found.Value;
				if (_config.SavedDevices.TryGetValue(device.Id, out var saved))
				{
					// Manual entry proves this route works but isn't a full discovery snapshot:
					// keep the saved name, primary host, and Bonjour addresses.
					try
					{
						_config.Save(saved.RememberConnectionCandidates([device.Host, .. device.Addresses]));
					}
					catch (Config.StorageException error)
					{
						ConfigStorageIssue = error.Issue;
						throw;
					}
					_manuallyIdentified.Remove(device.Id);
					RecordVerifiedRoute(device.Id, device.Host, device.DiscoveryInfo);
				}
				else
				{
					// Kept only while it's needed to drive first sign-in.
					_manuallyIdentified[device.Id] = device;
					_connectionHosts[device.Id] = device.Host;
					PublishFallbackHints();
					Rebuild();
				}
				return new AddressConnectionResult.Device(device.Id);
			case Umbreld.ManualDiscoveryResult.Unverified unverified:
				return new AddressConnectionResult.Unverified(unverified.Value);
			case Umbreld.ManualDiscoveryResult.UpdateRequired update:
				return new AddressConnectionResult.UpdateRequired(update.Value.Host);
			default:
				throw new ManualDiscoveryException(ManualDiscoveryErrorKind.NoDeviceFound);
		}
	}

	public void DiscardUnsavedManualDevice(string id)
	{
		if (!IsUnsavedManualOnlyDevice(id)) return;
		_manuallyIdentified.Remove(id);
		_connectionHosts.Remove(id);
		var discardedClaim = _explicitlyClaimedDeviceIds.Remove(id);
		PublishFallbackHints();
		Rebuild();
		if (discardedClaim) Umbreld.ForgetLocalHttpsIdentity(id);
	}

	public void SetDashboardUsesHttps(string id, bool value)
	{
		TryUpdateConfig(id, saved => saved with { DashboardUsesHttps = value });
		Rebuild();
	}

	public Task<bool> IsKnownEndpointAvailableAsync(string host, string id, CancellationToken ct) =>
		Umbreld.IsKnownEndpointAvailableAsync(host, id, ct);

	// ── Shares ──

	public Task MountAllInBackgroundAsync(string id, bool silent) => MountAllAsync(id, silent, null);

	private async Task MountAllAsync(string id, bool silent, Umbreld.UserInfo? userInfo)
	{
		if (!_sessions.TryGetValue(id, out var session)) return;
		var target = TargetFor(id);
		if (target is null) return;
		// Don't remap drives while a disconnect (or its Windows prompt) is in flight.
		if (_mountsInProgress.Contains(id) || _disconnecting.Contains(id)) return;
		_mountsInProgress.Add(id);
		if (!silent) _foregroundMounts.Add(id);
		UpdateForegroundActivity();
		try
		{
			await ReconcileSharesAsync(id, target, session, userInfo);
		}
		catch (OperationCanceledException)
		{
		}
		catch (UmbreldException error) when (error.IsAuthError)
		{
			await SessionExpiredAsync(id, session);
		}
		catch (Exception error)
		{
			// Leave the last known share list in place; the health loop retries.
			Trace.TraceWarning("Share refresh failed: {0}", FileLog.Describe(error));
		}
		finally
		{
			_mountsInProgress.Remove(id);
			_foregroundMounts.Remove(id);
			UpdateForegroundActivity();
			Rebuild();
			// A new account may have signed in while this pass awaited I/O. Its own pass was
			// skipped above, so start it once this stale one exits.
			if (_sessions.TryGetValue(id, out var current) && !current.BelongsToSameLogin(session))
			{
				_ = MountAllInBackgroundAsync(id, silent: true);
			}
		}
	}

	// Refreshes the share list, unmounts orphans (shares removed or renamed on the Umbrel)
	// and drives left on a route that no longer verifies, then maps anything unmapped.
	// Share status flows into the snapshot live, so rows show "Mounting…" as this runs.
	private async Task ReconcileSharesAsync(
		string id,
		Umbreld.Target target,
		Umbreld.Session session,
		Umbreld.UserInfo? providedUserInfo)
	{
		var ct = _lifetime.Token;
		var userInfo = providedUserInfo is not null && providedUserInfo.UserId == session.AccountId
			? providedUserInfo
			: await Umbreld.UserAsync(target, session, ct);
		if (!IsCurrentSession(session, id)) return;
		var access = new SambaAccess(userInfo.UserId, userInfo.SambaEnabled, userInfo.SambaUsername, userInfo.HomePath);
		_sambaAccess[id] = access;
		if (!access.Enabled)
		{
			// The owner turned off this member's file sharing and umbreld closed its shares.
			try
			{
				await UnmountAllSharesAsync(id);
			}
			catch (Exception error)
			{
				Trace.TraceWarning("Disabled-account unmount failed: {0}", FileLog.Describe(error));
			}
			_sambaCredentials.Remove(id);
			Rebuild();
			return;
		}

		var apiShares = await Umbreld.SharesAsync(target, session, ct);
		if (!IsCurrentSession(session, id)) return;
		var sharePassword = await Umbreld.SharePasswordAsync(target, session, ct);
		if (!IsCurrentSession(session, id)) return;
		var credential = (access.Username, sharePassword);
		if (_sambaCredentials.TryGetValue(id, out var previous) && previous != credential)
		{
			// A new share login means umbreld ended the old SMB session and Windows refuses a
			// second login to the same server, so release the dead drives and map fresh ones
			// below. If one won't release, keep the old login so the next check retries.
			try
			{
				await UnmountAllSharesAsync(id);
			}
			catch (Exception error)
			{
				Trace.TraceWarning("Share login change unmount failed: {0}", FileLog.Describe(error));
				return;
			}
		}
		_sambaCredentials[id] = credential;

		// API calls may have moved from a stale LAN route to Tailscale (or back). Resolve
		// after them so drives map to the endpoint that just proved the pinned identity.
		string connectionHost;
		try
		{
			connectionHost = await Umbreld.ResolvedHostAsync(target, ct);
		}
		catch (OperationCanceledException) when (ct.IsCancellationRequested)
		{
			throw;
		}
		catch (Exception)
		{
			return;
		}
		_connectionHosts[id] = connectionHost;
		if (!IsCurrentSession(session, id)) return;

		var mountedShares = (await VerifiedMountedSharesAsync(id, [connectionHost])).ToList();
		if (!IsCurrentSession(session, id)) return;

		// Drives survive an app relaunch. Reconcile only drives whose host proved this
		// Umbrel's identity; unverifiable ones may belong to another server and stay put.
		var currentSharenames = apiShares.Select(share => share.Sharename).ToHashSet(StringComparer.OrdinalIgnoreCase);
		foreach (var share in mountedShares.Where(share => !currentSharenames.Contains(share.Sharename)).ToList())
		{
			await UnmountQuietlyAsync(id, share.Path, "Orphan");
			if (!IsCurrentSession(session, id)) return;
		}
		mountedShares.RemoveAll(share => !Mounter.IsMounted(share.Path));

		// A route change can leave a drive on a host that no longer verifies even though the
		// Umbrel is reachable elsewhere. Windows only ever retries a drive's original host, so
		// a known drive is released here and mapped again below on the verified route. Other
		// drives stay unless their host still proves the pinned identity. Follow-up:
		// releasing a drive from an unreachable IP can take about a minute, and a drive with
		// open files is never released. Mapping the new route first would be quicker but
		// can change the drive letter.
		var alternateHosts = mountedShares
			.Where(share => IsKnownDrive(id, share) && !Mounter.HostsMatch(share.Host, connectionHost))
			.Select(share => share.Host)
			.DistinctBy(Mounter.NormalizeHost)
			.ToList();
		var unavailableHosts = new HashSet<string>(StringComparer.Ordinal);
		foreach (var host in alternateHosts)
		{
			var available = await Umbreld.IsKnownEndpointAvailableAsync(host, id, ct);
			if (!IsCurrentSession(session, id)) return;
			if (!available) unavailableHosts.Add(Mounter.NormalizeHost(host));
		}
		foreach (var share in mountedShares
			.Where(share => IsKnownDrive(id, share) && unavailableHosts.Contains(Mounter.NormalizeHost(share.Host)))
			.ToList())
		{
			await UnmountQuietlyAsync(id, share.Path, "Route-change");
			if (!IsCurrentSession(session, id)) return;
		}
		mountedShares.RemoveAll(share => !Mounter.IsMounted(share.Path));
		MergeShares(id, apiShares, mountedShares, connectionHost);
		Rebuild();

		var pending = (_deviceShares.GetValueOrDefault(id) ?? []).Where(share => share.Status != MountStatus.Mounted).ToList();
		if (pending.Count == 0) return;
		// Check the endpoint again right before it receives the share login. If it no longer
		// proves the pinned identity, drop the cached route and let the next pass re-resolve.
		if (!await Umbreld.IsKnownEndpointAvailableAsync(connectionHost, id, ct))
		{
			Trace.TraceWarning("Mounts skipped: the route didn't prove this Umbrel's identity");
			Umbreld.InvalidateResolvedHost(target);
			return;
		}
		if (!IsCurrentSession(session, id)) return;

		// Mounts run one at a time, so mark every pending share first: queued rows shouldn't
		// read "Reconnect" while the first mount sets up the SMB session.
		foreach (var share in pending) SetShare(id, share.Sharename, share.MountPath, MountStatus.Mounting);

		// Sequential mounts: parallel WNet calls race for the same server session. The first
		// mount attempted drops deviceless connections left from an earlier login, until one
		// succeeds.
		var needsFreshSession = mountedShares.Count == 0;
		foreach (var share in (_deviceShares.GetValueOrDefault(id) ?? []).ToList())
		{
			if (share.MountPath is { } existing && Mounter.IsMounted(existing))
			{
				SetShare(id, share.Sharename, existing, MountStatus.Mounted);
				continue;
			}
			if (!IsCurrentSession(session, id)) return;
			try
			{
				var path = await Mounter.MountAsync(
					connectionHost, share.Sharename, credential.Username, sharePassword, needsFreshSession, ct);
				Remember(id, new Mounter.MountedShare(connectionHost, share.Sharename, path));
				needsFreshSession = false;
				if (!IsCurrentSession(session, id))
				{
					// This drive was mapped for a login that is no longer active.
					await UnmountQuietlyAsync(id, path, "Stale-login");
					return;
				}
				SetShare(id, share.Sharename, path, MountStatus.Mounted);
			}
			catch (MountException error)
			{
				if (!IsCurrentSession(session, id)) return;
				SetShare(id, share.Sharename, null, MountStatus.Unmounted);
				Trace.TraceWarning("Mount failed: {0}", FileLog.Describe(error));
			}
		}
	}

	// Map API shares into rows from the verified drives, keeping a row's drive letter while
	// it still maps that share. A letter is not enough on its own: Windows reuses letters,
	// so it may now map something else. A mapped drive is authoritative: a row never stays
	// "Reconnect" once its drive is present.
	private void MergeShares(
		string id,
		IReadOnlyList<Umbreld.Share> apiShares,
		IReadOnlyList<Mounter.MountedShare> mountedShares,
		string connectionHost)
	{
		var existing = _deviceShares.GetValueOrDefault(id) ?? [];
		// The same share can be mapped twice, by address and by name; show the current route's.
		var preferred = mountedShares.OrderBy(share => Mounter.HostsMatch(share.Host, connectionHost) ? 0 : 1).ToList();
		_deviceShares[id] = apiShares.Select(api =>
		{
			var oldPath = existing.FirstOrDefault(share => share.Sharename == api.Sharename)?.MountPath;
			var drives = preferred.Where(share => string.Equals(share.Sharename, api.Sharename, StringComparison.OrdinalIgnoreCase)).ToList();
			var mounted = drives.FirstOrDefault(share => string.Equals(share.Path, oldPath, StringComparison.OrdinalIgnoreCase))
				?? drives.FirstOrDefault();
			if (mounted is null) return new Share(api.Name, api.Path, api.Sharename, null, MountStatus.Unmounted);
			Remember(id, mounted);
			return new Share(api.Name, api.Path, api.Sharename, mounted.Path, MountStatus.Mounted);
		}).ToList();
	}

	private void SetShare(string id, string sharename, string? path, MountStatus status)
	{
		if (!_deviceShares.TryGetValue(id, out var shares)) return;
		var updated = shares.ToList();
		var index = updated.FindIndex(share => share.Sharename == sharename);
		if (index < 0) return;
		updated[index] = updated[index] with { MountPath = path, Status = status };
		_deviceShares[id] = updated;
		Rebuild();
	}

	private List<Mounter.MountedShare> KnownDrives(string id)
	{
		if (!_knownDrives.TryGetValue(id, out var drives)) _knownDrives[id] = drives = [];
		return drives;
	}

	private void Remember(string id, Mounter.MountedShare drive)
	{
		if (!IsKnownDrive(id, drive)) KnownDrives(id).Add(drive);
	}

	private void ForgetDrive(string id, string path) =>
		KnownDrives(id).RemoveAll(drive => string.Equals(drive.Path, path, StringComparison.OrdinalIgnoreCase));

	// Background unmount: never prompts or forces, and only logs a drive that stays mapped.
	private async Task UnmountQuietlyAsync(string id, string path, string reason)
	{
		try
		{
			await Mounter.UnmountAsync(path, _lifetime.Token);
		}
		catch (MountException error)
		{
			if (Mounter.IsMounted(path)) Trace.TraceWarning("{0} unmount of {1} failed: {2}", reason, path, FileLog.Describe(error));
		}
		if (!Mounter.IsMounted(path)) ForgetDrive(id, path);
	}

	private HashSet<string> KnownHosts(string id)
	{
		var hosts = new List<string>();
		if (Device(id) is { } device)
		{
			hosts.Add(device.Host);
			hosts.AddRange(device.Addresses);
		}
		if (_config.SavedDevices.TryGetValue(id, out var saved))
		{
			hosts.Add(saved.Host);
			hosts.AddRange(saved.Addresses);
		}
		return hosts.Where(SavedDevice.IsValidLocalEndpointHost).ToHashSet(StringComparer.OrdinalIgnoreCase);
	}

	// A server-reported address is only a candidate. Before a drive counts as this Umbrel's,
	// its host must prove the pinned device identity or already be the endpoint verified in
	// this process. Known drives count too, even while their route is down.
	private async Task<IReadOnlyList<Mounter.MountedShare>> VerifiedMountedSharesAsync(
		string id,
		IReadOnlyCollection<string>? additionallyTrusting = null)
	{
		var trustedHosts = new List<string>(additionallyTrusting ?? []);
		if (_connectionHosts.TryGetValue(id, out var connectionHost)) trustedHosts.Add(connectionHost);
		// Trusted hosts are searched too: a manually entered route may not be a local name.
		// Known drives are included whatever their host: the Umbrel's name or address can
		// change while they stay mapped to the old one.
		var searchedHosts = KnownHosts(id).Concat(trustedHosts).Select(Mounter.NormalizeHost).ToHashSet(StringComparer.Ordinal);
		var candidates = Mounter.MountedShares()
			.Where(share => searchedHosts.Contains(Mounter.NormalizeHost(share.Host)) || IsKnownDrive(id, share))
			.ToList();
		if (candidates.Count == 0) return [];

		var verifiedHostKeys = candidates
			.Where(share => trustedHosts.Any(host => Mounter.HostsMatch(host, share.Host)))
			.Select(share => Mounter.NormalizeHost(share.Host))
			.ToHashSet(StringComparer.Ordinal);
		// Known drives need no check, so an old host that no longer answers isn't waited on.
		var hostsToVerify = candidates
			.Where(share => !IsKnownDrive(id, share))
			.Select(share => share.Host)
			.DistinctBy(Mounter.NormalizeHost)
			.Where(host => !verifiedHostKeys.Contains(Mounter.NormalizeHost(host)))
			.ToList();
		var results = await Task.WhenAll(hostsToVerify.Select(async host =>
			(Key: Mounter.NormalizeHost(host), Verified: await Umbreld.IsKnownEndpointAvailableAsync(host, id, _lifetime.Token))));
		verifiedHostKeys.UnionWith(results.Where(result => result.Verified).Select(result => result.Key));

		return candidates
			.Where(share => verifiedHostKeys.Contains(Mounter.NormalizeHost(share.Host)) || IsKnownDrive(id, share))
			.ToList();
	}

	// A drive this process mapped, or one it gave a share row after its host proved this
	// Umbrel's identity. Either stays its own while its route is down: Windows keeps the
	// drive mapped, and Disconnect or a route change must still be able to release it. The
	// host and share must match as well as the letter, because Windows reuses letters.
	private bool IsKnownDrive(string id, Mounter.MountedShare share) =>
		KnownDrives(id).Any(known =>
			string.Equals(known.Path, share.Path, StringComparison.OrdinalIgnoreCase)
			&& string.Equals(known.Sharename, share.Sharename, StringComparison.OrdinalIgnoreCase)
			&& Mounter.HostsMatch(known.Host, share.Host));

	// Every disconnect is first tried unforced on the thread pool. With confirmWithUser
	// (Disconnect, Forget, switching account), a drive with open files is forced if the
	// user agrees. Background callers never prompt or force.
	private async Task UnmountAllSharesAsync(string id, bool confirmWithUser = false)
	{
		var shares = _deviceShares.GetValueOrDefault(id) ?? [];
		var owned = await VerifiedMountedSharesAsync(id);
		var mountedPaths = owned
			.Select(share => share.Path)
			.Distinct(StringComparer.OrdinalIgnoreCase)
			.Order(StringComparer.OrdinalIgnoreCase)
			.ToList();
		// Unlike macOS, a tracked row whose drive still maps its share is always owned (see
		// IsKnownDrive), so there is no unverifiable tracked drive to report.
		var ownedPaths = mountedPaths.ToHashSet(StringComparer.OrdinalIgnoreCase);

		// Mark the whole batch first because unmounts run one at a time.
		_deviceShares[id] = shares
			.Select(share => share.MountPath is { } path && ownedPaths.Contains(path)
				? share with { Status = MountStatus.Unmounting }
				: share)
			.ToList();
		Rebuild();

		// failed: a drive is still mapped. refused: Windows wouldn't release one. kept: the
		// user chose not to force one with open files.
		var failed = false;
		var refused = false;
		var kept = false;
		foreach (var path in mountedPaths)
		{
			var error = await TryUnmountAsync(path, force: false);
			if (error is not null && confirmWithUser && Mounter.HasOpenFiles(error))
			{
				if (!ConfirmForcedDisconnect(path))
				{
					// The user kept this drive; stop asking.
					failed = true;
					kept = true;
					break;
				}
				error = await TryUnmountAsync(path, force: true);
			}
			// Check the drive table before reporting, in case it vanished concurrently.
			if (error is not null && Mounter.IsMounted(path))
			{
				failed = true;
				refused = true;
				Trace.TraceWarning("Unmount of {0} failed: {1}", path, FileLog.Describe(error));
			}
			if (!Mounter.IsMounted(path)) ForgetDrive(id, path);
		}

		if (!failed)
		{
			_deviceShares.Remove(id);
		}
		else
		{
			// Drives that stayed mapped keep their row.
			_deviceShares[id] = shares.Select(share => share.MountPath is { } path && Mounter.IsMounted(path)
				? share with { Status = MountStatus.Mounted }
				: share with { MountPath = null, Status = MountStatus.Unmounted }).ToList();
		}
		Rebuild();
		if (refused) throw new ShareUnmountException();
		if (kept) throw new ShareUnmountCancelledException();
	}

	private async Task<MountException?> TryUnmountAsync(string path, bool force)
	{
		try
		{
			await Mounter.UnmountAsync(path, _lifetime.Token, force);
			return null;
		}
		catch (MountException error)
		{
			return error;
		}
	}

	// Forcing a drive with open files can lose their unsaved changes, so the user decides.
	// Owned by the panel, which stays open behind it.
	private static bool ConfirmForcedDisconnect(string path) => ConfirmDialog.Show(
		System.Windows.Application.Current.Windows.OfType<System.Windows.Window>().FirstOrDefault(window => window.IsActive),
		$"Files on {path.TrimEnd('\\')} are still open",
		"Disconnecting anyway may lose unsaved changes in them.",
		"Disconnect");

	public async Task ShareHomeFolderAsync(string id)
	{
		if (_sharingHome.Contains(id)) return;
		if (!_sessions.TryGetValue(id, out var session)) return;
		var target = TargetFor(id);
		if (target is null) return;
		_sharingHome.Add(id);
		Rebuild();
		try
		{
			var access = _sambaAccess.GetValueOrDefault(id);
			var homePath = access is not null && access.AccountId == session.AccountId
				? access.HomePath
				: (await Umbreld.UserAsync(target, session, _lifetime.Token)).HomePath;
			try
			{
				await Umbreld.AddShareAsync(target, session, homePath, _lifetime.Token);
			}
			catch (UmbreldException error) when (error.IsConnectivityFailure)
			{
				// The server may have committed the share before its response was lost.
				// Confirm rather than replay the mutation.
				var shares = await Umbreld.SharesAsync(target, session, _lifetime.Token);
				if (!shares.Any(share => share.Path == homePath)) throw;
			}
			if (!IsCurrentSession(session, id)) return;
			await MountAllAsync(id, silent: false, null);
		}
		finally
		{
			_sharingHome.Remove(id);
			Rebuild();
		}
	}

	// ── Snapshot ──

	private Umbreld.Target? TargetFor(string id)
	{
		if (_config.SavedDevices.TryGetValue(id, out var saved)) return saved.NativeTarget;
		var live = IdentifiedCandidate(id);
		return live is null ? null : new Umbreld.Target(id, new[] { live.Host }.Concat(live.Addresses));
	}

	// Every verified unsaved record, one per id. A manually checked endpoint wins, then the
	// DNS-SD record, which carries the advertised addresses, then the hostname scan's.
	private Dictionary<string, IdentifiedDevice> IdentifiedCandidates()
	{
		var identified = new Dictionary<string, IdentifiedDevice>(StringComparer.Ordinal);
		foreach (var device in _fallbackIdentified) identified.TryAdd(device.Id, device);
		foreach (var (id, device) in _mdnsIdentified) identified[id] = device;
		foreach (var (id, device) in _manuallyIdentified) identified[id] = device;
		return identified;
	}

	private IdentifiedDevice? IdentifiedCandidate(string id) =>
		_manuallyIdentified.GetValueOrDefault(id) ?? _mdnsIdentified.GetValueOrDefault(id)
		?? _fallbackIdentified.Find(device => device.Id == id);

	private void TryUpdateConfig(string id, Func<SavedDevice, SavedDevice> mutate)
	{
		try
		{
			_config.Update(id, mutate);
		}
		catch (Config.StorageException error)
		{
			ConfigStorageIssue = error.Issue;
		}
	}

	private void UpdateForegroundActivity() =>
		HasForegroundActivity = _connecting.Count > 0 || _disconnecting.Count > 0 || _foregroundMounts.Count > 0;

	private void Rebuild()
	{
		var now = DateTimeOffset.UtcNow;
		var saved = _config.SavedDevices;
		var list = new List<Device>();
		var seen = new HashSet<string>(StringComparer.Ordinal);

		// Prefer an explicitly checked endpoint when sources identify the same Umbrel; it may
		// be the Tailscale route the user needs right now.
		var identified = IdentifiedCandidates();
		foreach (var live in identified.Values.OrderBy(device => device.Host, StringComparer.Ordinal))
		{
			seen.Add(live.Id);
			list.Add(OnlineDevice(live.Id, saved.GetValueOrDefault(live.Id), live));
		}
		foreach (var record in saved.Values)
		{
			if (seen.Contains(record.Id)) continue;
			if (_probes.TryGetValue(record.Id, out var probe) && probe.IsFresh(now) && probe.Identity?.Id == record.Id)
			{
				seen.Add(record.Id);
				list.Add(OnlineDevice(record.Id, record, null, probe));
			}
		}
		foreach (var record in saved.Values)
		{
			if (seen.Contains(record.Id)) continue;
			// Opening the panel at launch can start the first probe before the initial
			// sweep, which then skips it as in flight. Until it answers, nothing is known.
			var reachability = _probes.ContainsKey(record.Id)
				|| (_completedInitialReachabilityCheck && !_probesInFlight.Contains(record.Id))
				? DeviceReachability.Offline
				: DeviceReachability.Unverified;
			list.Add(new Device
			{
				Id = record.Id,
				Name = record.Name,
				Host = record.Host,
				ConnectionHost = _connectionHosts.GetValueOrDefault(record.Id),
				Addresses = record.Addresses,
				Model = record.Model,
				UserName = record.UserName,
				Reachability = reachability,
				Saved = true,
				Connection = ConnectionState(record.Id),
				Shares = [],
				DashboardUsesHttps = record.DashboardUsesHttps ?? false,
				IdentityChanged = reachability == DeviceReachability.Offline && _identityChanged.Contains(record.Id),
			});
		}

		// Saved and online first, then saved and offline, then discovered.
		static int Priority(Device device) => device.Saved && device.Online ? 0 : device.Saved ? 1 : 2;
		var ordered = list
			.OrderBy(Priority)
			.ThenBy(device => device.Name, StringComparer.CurrentCulture)
			.ToList();
		// Skip no-op updates so the panel and tray aren't invalidated for nothing.
		if (!SameDevices(ordered, _devices)) Devices = ordered;

		var savedDevices = ordered.Where(device => device.Saved).ToList();
		ShowsAlertIcon = savedDevices.Count > 0
			&& savedDevices.All(device => device.Reachability != DeviceReachability.Unverified)
			&& !savedDevices.Any(device => device.Online && device.Connection == Umbrel.ConnectionState.Connected);
		UpdateForegroundActivity();
	}

	private static bool SameDevices(IReadOnlyList<Device> lhs, IReadOnlyList<Device> rhs) =>
		lhs.Count == rhs.Count && lhs.Zip(rhs).All(pair => SameDevice(pair.First, pair.Second));

	// Device is a record, but its list members compare by reference.
	private static bool SameDevice(Device lhs, Device rhs) =>
		lhs with { Addresses = rhs.Addresses, Shares = rhs.Shares } == rhs
		&& lhs.Addresses.SequenceEqual(rhs.Addresses)
		&& lhs.Shares.SequenceEqual(rhs.Shares);

	private Device OnlineDevice(string id, SavedDevice? saved, IdentifiedDevice? live, ProbeRecord? probe = null)
	{
		var addresses = new List<string>();
		var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
		foreach (var address in (saved?.Addresses ?? []).Concat(live?.Addresses ?? []))
		{
			if (address.Length > 0 && seen.Add(address)) addresses.Add(address);
		}
		return new Device
		{
			Id = id,
			Name = saved?.Name ?? live?.Name ?? id,
			// The card names the saved host; the live route is ConnectionHost.
			Host = saved?.Host ?? live?.Host ?? probe?.Host ?? "",
			ConnectionHost = _connectionHosts.GetValueOrDefault(id),
			Addresses = addresses,
			Model = live?.Model ?? probe?.Identity?.Device ?? saved?.Model,
			UserName = saved?.UserName,
			Reachability = DeviceReachability.Online,
			Saved = saved is not null,
			Connection = ConnectionState(id),
			Shares = _deviceShares.GetValueOrDefault(id) ?? [],
			Onboarded = live?.Onboarded ?? probe?.Identity?.Onboarded,
			DashboardUsesHttps = saved?.DashboardUsesHttps ?? false,
		};
	}
}
