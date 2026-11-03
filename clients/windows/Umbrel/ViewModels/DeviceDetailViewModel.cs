using System.ComponentModel;
using System.Windows.Media;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Umbrel.Services;
using Umbrel.Views;
using Umbrel.Core;

namespace Umbrel.ViewModels;

public enum DetailMode
{
	Loading,
	Offline,
	Setup,
	SignIn,
	Idle,
	Connected,
	BrowserSettings,
}

/// <summary>One address in the access box. Keyed by host, so availability survives an HTTPS switch.</summary>
public sealed class AccessRow(string host, bool hasDivider) : ObservableObject
{
	private string _url = "";
	private bool? _available;

	public static string TailscaleIconPath => Presentation.AssetPath("tailscale.png");

	public string Host => host;
	public bool HasDivider => hasDivider;
	public bool IsTailscale => SavedDevice.IsTailscaleAddress(host);

	public string Url
	{
		get => _url;
		set => SetProperty(ref _url, value);
	}

	public bool? Available
	{
		get => _available;
		set
		{
			if (!SetProperty(ref _available, value)) return;
			OnPropertyChanged(nameof(Opacity));
			OnPropertyChanged(nameof(AvailabilityText));
		}
	}

	public double Opacity => Available switch { true => 1.0, false => 0.4, _ => 0.65 };
	public string AvailabilityText => Available switch { true => "Available", false => "Unavailable", _ => "Checking availability" };
}

public sealed class ShareRow(Share share, bool hasDivider)
{
	public string Name => share.Sharename;
	public string? MountPath => share.MountPath;
	public bool HasDivider => hasDivider;
	public bool CanOpen => share.Status == MountStatus.Mounted && share.MountPath is not null;
	public bool IsActionable => share.Status is MountStatus.Mounted or MountStatus.Unmounted;
	public bool IsBusy => share.Status is MountStatus.Mounting or MountStatus.Unmounting;
	public string StatusText => share.Status switch
	{
		MountStatus.Mounting => "Mounting…",
		MountStatus.Unmounting => "Unmounting…",
		MountStatus.Mounted => "View in File Explorer ›",
		_ => "Reconnect ›",
	};
	public string ActionLabel => CanOpen ? $"View {Name} in File Explorer" : $"Reconnect {Name}";
}

/// <summary>One device's page: sign-in form, access rows, and shared-folder mounts.</summary>
public sealed class DeviceDetailViewModel : ObservableObject, IDisposable
{
	// The macOS statusBadgeConfig(for:) ring colors.
	private static readonly Brush ConnectedRing = Frozen(Color.FromRgb(0x00, 0xD0, 0x61));
	private static readonly Brush DisconnectedRing = Frozen(Color.FromRgb(0xFF, 0x5D, 0x41));

	private readonly AppState _state;
	private readonly CancellationTokenSource _cts = new();
	private readonly Dictionary<string, bool> _availability = new(StringComparer.OrdinalIgnoreCase);
	private CancellationTokenSource? _connectCts;
	private CancellationTokenSource? _probeCts;
	private string? _probedHosts;
	private (string Host, bool Online, bool? Onboarded)? _accountLoadContext;
	private Device? _device;
	private DetailMode _mode = DetailMode.Loading;
	private bool _browserSettingsOpen;
	private bool _showPasswordForm;
	private bool _requires2fa;
	private IReadOnlyList<Umbreld.Account> _accounts = [];
	private string? _selectedUserId;
	private Umbreld.Target? _accountTarget;
	private bool _loadingAccounts;
	private string? _accountError;
	private bool _busy;
	private string? _error;
	private string? _actionError;
	private string? _shareHomeError;
	private IReadOnlyList<AccessRow> _accessRows = [];
	private IReadOnlyList<Share> _shareSource = [];
	private IReadOnlyList<ShareRow> _shares = [];

	public DeviceDetailViewModel(string deviceId, AppState state, ShellViewModel shell)
	{
		DeviceId = deviceId;
		_state = state;
		BackCommand = new RelayCommand(() =>
		{
			if (_browserSettingsOpen)
			{
				_browserSettingsOpen = false;
				Recompute();
				return;
			}
			_connectCts?.Cancel();
			shell.ShowList();
		});
		SubmitCommand = new AsyncRelayCommand<PasswordSubmission>(ConnectAsync);
		ClearErrorCommand = new RelayCommand(() => Error = null);
		DisconnectCommand = new AsyncRelayCommand(() => RunActionAsync(() => state.DisconnectAsync(deviceId)));
		ForgetCommand = new AsyncRelayCommand(() =>
		{
			_connectCts?.Cancel();
			return RunActionAsync(async () =>
			{
				await state.ForgetAsync(deviceId);
				shell.ShowList();
			});
		});
		ReconnectCommand = new AsyncRelayCommand(() =>
		{
			_connectCts?.Cancel();
			return RunActionAsync(async () =>
			{
				await state.ReconnectAsync(deviceId);
				shell.ShowList();
			});
		});
		ReconnectCommand.PropertyChanged += (_, e) =>
		{
			if (e.PropertyName == nameof(IAsyncRelayCommand.IsRunning)) OnPropertyChanged(nameof(ReconnectText));
		};
		ShowPasswordFormCommand = new RelayCommand(() =>
		{
			_showPasswordForm = true;
			Recompute();
		});
		ConnectWhileOfflineCommand = new RelayCommand(() =>
		{
			_showPasswordForm = true;
			Recompute();
			_ = LoadAccountsAsync();
		});
		RetryCommand = new AsyncRelayCommand(LoadAccountsAsync);
		SelectAccountCommand = new RelayCommand<Umbreld.Account>(account =>
		{
			if (account is null) return;
			SelectedUserId = account.UserId;
			_requires2fa = false;
			Error = null;
			Recompute();
		});
		OpenBrowserSettingsCommand = new RelayCommand(() =>
		{
			_browserSettingsOpen = true;
			Recompute();
		});
		ShareHomeCommand = new AsyncRelayCommand(ShareHomeAsync);
		ShareCommand = new RelayCommand<ShareRow>(row =>
		{
			if (row is null) return;
			if (row.CanOpen) Browser.Open(row.MountPath!);
			else _ = state.MountAllInBackgroundAsync(deviceId, silent: false);
		});
		state.PropertyChanged += OnStateChanged;
		Recompute();
	}

	public string DeviceId { get; }

	public Device? Device
	{
		get => _device;
		private set => SetProperty(ref _device, value);
	}

	public DetailMode Mode
	{
		get => _mode;
		private set
		{
			if (SetProperty(ref _mode, value)) NotifySignInState();
		}
	}

	// ── Header ──

	public UmbrelDeviceKind Kind => Device?.Kind ?? UmbrelDeviceKind.Generic;
	public string UserNamePart => Device?.UserName is { } name ? $"{name}’s " : "";
	public string ModelPart => Device?.DisplayModel ?? "";
	public StatusInfo? Status => Device is null ? null : Presentation.Status(Device);
	public string? RouteText => Device is null ? null : Presentation.RouteLabel(Device, _state.ConnectionHost(DeviceId));
	public string? BadgeSource => Device switch
	{
		{ Saved: false } or { Reachability: DeviceReachability.Unverified } => null,
		{ Online: true, Connection: ConnectionState.Connected } => Presentation.AssetPath("status-connected.png"),
		_ => Presentation.AssetPath("status-disconnected.png"),
	};
	public Brush BadgeRingColor => Device is { Online: true, Connection: ConnectionState.Connected } ? ConnectedRing : DisconnectedRing;

	// ── Footer ──

	public string BackText => _browserSettingsOpen ? "Back" : "All devices";

	// Forget is always reachable for a saved device unless the main content already offers
	// it (the Forget/Connect pair for an online, signed-out device).
	public bool ShowFooterActions => !_browserSettingsOpen && Device is { Saved: true } device
		&& !(device.Online && device.Connection == ConnectionState.NotAuthenticated && !_showPasswordForm);

	public bool ShowDisconnecting => Device is { Connection: ConnectionState.Disconnecting };
	public bool ShowDisconnect => Device is { Connection: ConnectionState.Connected };

	public string? ActionError
	{
		get => _actionError;
		private set
		{
			SetProperty(ref _actionError, value);
			OnPropertyChanged(nameof(HasActionError));
		}
	}

	public bool HasActionError => ActionError is not null;

	// ── Offline ──

	// Signing in to an Umbrel with a new identity waits until the user has checked it.
	public bool ShowOfflineConnect => Device is { Saved: true, Connection: ConnectionState.NotAuthenticated, IdentityChanged: false };

	public bool ShowIdentityChanged => Device is { IdentityChanged: true };

	public string ReconnectText => ReconnectCommand.IsRunning ? "Reconnecting…" : "Reconnect";

	// ── Sign in ──

	public IReadOnlyList<Umbreld.Account> Accounts
	{
		get => _accounts;
		private set
		{
			SetProperty(ref _accounts, value);
			OnPropertyChanged(nameof(ShowAccountPicker));
			OnPropertyChanged(nameof(PromptText));
			NotifySignInState();
		}
	}

	/// <summary>The account to sign in as. Null only before accounts load.</summary>
	public string? SelectedUserId
	{
		get => _selectedUserId;
		private set
		{
			SetProperty(ref _selectedUserId, value);
			OnPropertyChanged(nameof(PromptText));
			NotifySignInState();
		}
	}

	private Umbreld.Account? SelectedAccount => Accounts.FirstOrDefault(account => account.UserId == SelectedUserId);

	/// <summary>The Umbrel that serves the account avatars.</summary>
	public Umbreld.Target? AccountTarget
	{
		get => _accountTarget;
		private set
		{
			SetProperty(ref _accountTarget, value);
			OnPropertyChanged(nameof(ShowAccountPicker));
		}
	}

	public bool ShowAccountPicker => Accounts.Count > 1 && AccountTarget is not null;

	public bool LoadingAccounts
	{
		get => _loadingAccounts;
		private set
		{
			if (SetProperty(ref _loadingAccounts, value)) NotifySignInState();
		}
	}

	public string? AccountError
	{
		get => _accountError;
		private set
		{
			if (SetProperty(ref _accountError, value)) NotifySignInState();
		}
	}

	public bool ShowAccountSpinner => LoadingAccounts && Accounts.Count == 0;
	public bool ShowAccountError => !ShowAccountSpinner && AccountError is not null;

	/// <summary>False whenever the form is off screen; the view then empties it, as macOS rebuilds it.</summary>
	public bool ShowSignInForm => Mode == DetailMode.SignIn && !ShowAccountSpinner && AccountError is null && SelectedAccount is not null;

	public bool RequiresTwoFactor => _requires2fa;

	public string PromptText => _requires2fa ? "Enter the code from your authenticator app"
		: Accounts.Count > 1 && SelectedAccount is { } account ? $"Enter the password for {account.Name}:"
		: Device is { Saved: false } ? "Enter your umbrelOS password to connect:"
		: Device is { Connection: ConnectionState.Expired } ? "Your login session has expired. Enter your password to reconnect:"
		: "Enter your password to connect:";

	public bool Busy
	{
		get => _busy;
		private set
		{
			SetProperty(ref _busy, value);
			OnPropertyChanged(nameof(CanSelectAccount));
		}
	}

	// macOS disables the picker while a sign-in request runs.
	public bool CanSelectAccount => !Busy;

	public string? Error
	{
		get => _error;
		private set
		{
			SetProperty(ref _error, value);
			OnPropertyChanged(nameof(HasError));
		}
	}

	public bool HasError => Error is not null;

	// ── Access and file sharing ──

	public IReadOnlyList<AccessRow> AccessRows
	{
		get => _accessRows;
		private set => SetProperty(ref _accessRows, value);
	}

	public IReadOnlyList<ShareRow> Shares
	{
		get => _shares;
		private set => SetProperty(ref _shares, value);
	}

	public bool CanUseFileSharing => _state.CanUseFileSharing(DeviceId);
	public bool SharesLoading => _state.DeviceShares(DeviceId) is null;
	public bool ShowShareHomePrompt => !SharesLoading && Shares.Count == 0;
	public bool ShowShares => !SharesLoading && Shares.Count > 0;
	public string ShareHomeText => _state.IsSharingHome(DeviceId) ? "Sharing…" : "Share your entire Home folder";

	public string? ShareHomeError
	{
		get => _shareHomeError;
		private set
		{
			SetProperty(ref _shareHomeError, value);
			OnPropertyChanged(nameof(HasShareHomeError));
		}
	}

	public bool HasShareHomeError => ShareHomeError is not null;

	public bool DashboardUsesHttps => Device?.DashboardUsesHttps ?? false;

	public IRelayCommand BackCommand { get; }
	public IAsyncRelayCommand<PasswordSubmission> SubmitCommand { get; }
	public IRelayCommand ClearErrorCommand { get; }
	public IAsyncRelayCommand DisconnectCommand { get; }
	public IAsyncRelayCommand ForgetCommand { get; }
	public IAsyncRelayCommand ReconnectCommand { get; }
	public IRelayCommand ShowPasswordFormCommand { get; }
	public IRelayCommand ConnectWhileOfflineCommand { get; }
	public IAsyncRelayCommand RetryCommand { get; }
	public IRelayCommand<Umbreld.Account> SelectAccountCommand { get; }
	public IRelayCommand OpenBrowserSettingsCommand { get; }
	public IAsyncRelayCommand ShareHomeCommand { get; }
	public IRelayCommand<ShareRow> ShareCommand { get; }

	public void SetDashboardUsesHttps(bool value) => _state.SetDashboardUsesHttps(DeviceId, value);

	private async Task LoadAccountsAsync()
	{
		if (LoadingAccounts) return;
		LoadingAccounts = true;
		AccountError = null;
		try
		{
			var loaded = await _state.PrepareToSignInAsync(DeviceId, _cts.Token);
			if (loaded.Count == 0)
			{
				AccountError = "No accounts are available on this Umbrel.";
				return;
			}
			Accounts = loaded;
			var preferred = _state.LastAccountId(DeviceId);
			SelectedUserId = loaded.FirstOrDefault(account => account.UserId == preferred)?.UserId
				?? loaded.FirstOrDefault(account => account.UserId == "0")?.UserId
				?? loaded[0].UserId;
			_requires2fa = false;
			Error = null;
		}
		catch (OperationCanceledException) when (_cts.IsCancellationRequested)
		{
		}
		catch (Exception)
		{
			AccountError = "Couldn’t load accounts.";
		}
		finally
		{
			LoadingAccounts = false;
			Recompute();
		}
	}

	private async Task ConnectAsync(PasswordSubmission? submission)
	{
		if (Busy || submission is null) return;
		var cts = CancellationTokenSource.CreateLinkedTokenSource(_cts.Token);
		_connectCts = cts;
		Busy = true;
		Error = null;
		try
		{
			await _state.ConnectAsync(DeviceId, SelectedAccount, submission.Password, submission.Totp, cts.Token);
			_requires2fa = false;
			_showPasswordForm = false;
		}
		catch (OperationCanceledException) when (cts.IsCancellationRequested)
		{
		}
		catch (ShareUnmountCancelledException)
		{
			// Switching account stopped where the user kept the other account's open files.
		}
		catch (UmbreldException error) when (error.RequiresTwoFactorAuthentication)
		{
			if (!cts.IsCancellationRequested) _requires2fa = true;
		}
		catch (Exception error)
		{
			if (!cts.IsCancellationRequested) Error = error.Message;
		}
		finally
		{
			_connectCts = null;
			Busy = false;
			Recompute();
		}
	}

	// Show Disconnect, Forget and Reconnect failures (a drive Windows won't release) instead
	// of crashing.
	private async Task RunActionAsync(Func<Task> action)
	{
		ActionError = null;
		try
		{
			await action();
		}
		catch (ShareUnmountCancelledException)
		{
			// The user kept a drive with open files; the action stops there.
		}
		catch (Exception error)
		{
			ActionError = error.Message;
		}
	}

	private async Task ShareHomeAsync()
	{
		ShareHomeError = null;
		try
		{
			await _state.ShareHomeFolderAsync(DeviceId);
		}
		catch (Exception error)
		{
			ShareHomeError = error.Message;
		}
	}

	private void OnStateChanged(object? sender, PropertyChangedEventArgs e) => Recompute();

	private void Recompute()
	{
		if (_cts.IsCancellationRequested) return;
		Device = _state.Device(DeviceId);
		if (Device is not { } device) return;
		Mode = ComputeMode(device);
		AccountTarget = _state.NativeTarget(DeviceId);
		UpdateAccessRows(device);
		if (!device.Shares.SequenceEqual(_shareSource))
		{
			_shareSource = device.Shares;
			Shares = device.Shares.Select((share, index) => new ShareRow(share, index > 0)).ToList();
		}
		foreach (var name in new[]
		{
			nameof(Kind), nameof(UserNamePart), nameof(ModelPart), nameof(Status), nameof(RouteText),
			nameof(BadgeSource), nameof(BadgeRingColor), nameof(BackText), nameof(ShowFooterActions), nameof(ShowDisconnecting),
			nameof(ShowDisconnect), nameof(ShowOfflineConnect), nameof(ShowIdentityChanged), nameof(RequiresTwoFactor), nameof(PromptText), nameof(CanUseFileSharing),
			nameof(SharesLoading), nameof(ShowShareHomePrompt), nameof(ShowShares), nameof(ShareHomeText),
			nameof(DashboardUsesHttps),
		})
		{
			OnPropertyChanged(name);
		}
		LoadAccountsIfNeeded(device);
	}

	// Same order as the macOS main(_:) and savedContent(_:).
	private DetailMode ComputeMode(Device device)
	{
		if (_browserSettingsOpen) return DetailMode.BrowserSettings;
		if (device.Reachability == DeviceReachability.Unverified) return DetailMode.Loading;
		// A new identity shows its warning even over a sign-in form opened while offline.
		if (!device.Online && (device.IdentityChanged || !(device.Saved && _showPasswordForm))) return DetailMode.Offline;
		if (!device.Saved) return device.Onboarded == false ? DetailMode.Setup : DetailMode.SignIn;
		// One form across notAuthenticated -> connecting -> notAuthenticated, so a first
		// attempt that turns up 2FA keeps the typed password. A background connect shows
		// the connected page.
		if (_showPasswordForm || device.Connection == ConnectionState.Expired
			|| (device.Connection == ConnectionState.Connecting && Busy))
		{
			return DetailMode.SignIn;
		}
		return device.Connection == ConnectionState.NotAuthenticated ? DetailMode.Idle : DetailMode.Connected;
	}

	// Like the macOS .task(id:), reload accounts whenever the host, reachability or setup
	// state changes, so the form is ready before Connect is pressed.
	private void LoadAccountsIfNeeded(Device device)
	{
		var context = (device.Host, device.Online, device.Onboarded);
		if (_accountLoadContext == context) return;
		_accountLoadContext = context;
		if (device.Online && device.Onboarded != false) _ = LoadAccountsAsync();
	}

	// macOS accessBox: the host and its addresses, deduplicated. Saved devices probe each
	// address once per address set; until then the verified connection host counts as up.
	private void UpdateAccessRows(Device device)
	{
		if (Mode is not (DetailMode.Setup or DetailMode.Connected))
		{
			_probeCts?.Cancel();
			_probedHosts = null;
			return;
		}
		var hosts = new[] { device.Host }.Concat(device.Addresses)
			.Where(SavedDevice.IsValidLocalEndpointHost)
			.Distinct(StringComparer.OrdinalIgnoreCase)
			.ToList();
		if (!hosts.SequenceEqual(AccessRows.Select(row => row.Host)))
		{
			AccessRows = hosts.Select((host, index) => new AccessRow(host, index > 0)).ToList();
		}
		foreach (var row in AccessRows)
		{
			// Tailscale already encrypts the connection; HTTPS only matters on the local network.
			var scheme = device.DashboardUsesHttps && !row.IsTailscale ? "https" : "http";
			row.Url = $"{scheme}://{row.Host}";
			var isActive = string.Equals(device.ConnectionHost, row.Host, StringComparison.OrdinalIgnoreCase);
			row.Available = _availability.TryGetValue(row.Host, out var available) ? available : isActive ? true : null;
		}

		var probedHosts = device.Saved ? string.Join("\n", hosts) : null;
		if (probedHosts == _probedHosts) return;
		_probedHosts = probedHosts;
		_probeCts?.Cancel();
		if (probedHosts is null) return;
		var cts = CancellationTokenSource.CreateLinkedTokenSource(_cts.Token);
		_probeCts = cts;
		foreach (var host in hosts) _ = ProbeAsync(host, cts.Token);
	}

	private async Task ProbeAsync(string host, CancellationToken ct)
	{
		try
		{
			var available = await _state.IsKnownEndpointAvailableAsync(host, DeviceId, ct);
			if (ct.IsCancellationRequested) return;
			_availability[host] = available;
			if (AccessRows.FirstOrDefault(row => row.Host == host) is { } row) row.Available = available;
		}
		catch (OperationCanceledException)
		{
		}
	}

	private void NotifySignInState()
	{
		OnPropertyChanged(nameof(ShowAccountSpinner));
		OnPropertyChanged(nameof(ShowAccountError));
		OnPropertyChanged(nameof(ShowSignInForm));
	}

	private static Brush Frozen(Color color)
	{
		var brush = new SolidColorBrush(color);
		brush.Freeze();
		return brush;
	}

	public void Dispose()
	{
		_state.PropertyChanged -= OnStateChanged;
		_connectCts?.Cancel();
		_cts.Cancel();
	}
}
