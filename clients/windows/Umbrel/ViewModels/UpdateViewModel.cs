using System.Reflection;
using System.Windows.Threading;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Umbrel.Services;
using Umbrel.Views;

namespace Umbrel.ViewModels;

/// <summary>
/// The software update flow, ported from the macOS UpdateController: a manual check from
/// the tray menu, a background check every 6 hours that prompts at most once per version,
/// and an install that Windows finishes by closing and reopening Umbrel. One window shows
/// every state. Closing it dismisses that state, except during an install, which keeps
/// going.
/// </summary>
public sealed class UpdateViewModel : ObservableObject
{
	// The macOS app's check interval. Shorter than daily because an umbrelOS update can
	// need a matching app update the same day.
	private static readonly TimeSpan CheckInterval = TimeSpan.FromHours(6);
	// Windows only restarts an app that has been running for at least 60 seconds, so
	// waiting that long means an update accepted from the first prompt reopens Umbrel.
	private static readonly TimeSpan FirstCheckDelay = TimeSpan.FromMinutes(1);

	private readonly DispatcherTimer _timer;
	private UpdateWindow? _window;
	private Action? _primaryAction;
	private Action? _secondaryAction;
	private Action? _closeAction;
	private bool _sessionActive;
	private string? _availableVersion;
	private string _title = "";
	private string? _message;
	private bool _showsProgress;
	private bool _isIndeterminate;
	private double _progress;
	private string? _primaryButton;
	private string? _secondaryButton;
	private bool _buttonsEnabled = true;
	private ReleaseNotes? _notes;
	private bool _notesExpanded;

	public UpdateViewModel()
	{
		_timer = new DispatcherTimer(DispatcherPriority.Background) { Interval = FirstCheckDelay };
		_timer.Tick += async (_, _) =>
		{
			_timer.Interval = CheckInterval;
			await CheckInBackgroundAsync();
		};
		PrimaryCommand = new RelayCommand(() => Perform(_primaryAction));
		SecondaryCommand = new RelayCommand(() => Perform(_secondaryAction));
		_availableVersion = RestoredAvailableVersion();
	}

	/// <summary>Marketing version of a known update; the tray menu then offers it.</summary>
	public string? AvailableVersion
	{
		get => _availableVersion;
		private set => SetProperty(ref _availableVersion, value);
	}

	/// <summary>False while a check, prompt, or install is in progress, as on macOS.</summary>
	public bool CanCheckForUpdates => !_sessionActive;

	public string Title
	{
		get => _title;
		private set => SetProperty(ref _title, value);
	}

	public string? Message
	{
		get => _message;
		private set => SetProperty(ref _message, value);
	}

	public bool ShowsProgress
	{
		get => _showsProgress;
		private set => SetProperty(ref _showsProgress, value);
	}

	public bool IsIndeterminate
	{
		get => _isIndeterminate;
		private set => SetProperty(ref _isIndeterminate, value);
	}

	public double Progress
	{
		get => _progress;
		private set => SetProperty(ref _progress, value);
	}

	public string? PrimaryButton
	{
		get => _primaryButton;
		private set => SetProperty(ref _primaryButton, value);
	}

	public string? SecondaryButton
	{
		get => _secondaryButton;
		private set => SetProperty(ref _secondaryButton, value);
	}

	public bool ButtonsEnabled
	{
		get => _buttonsEnabled;
		private set => SetProperty(ref _buttonsEnabled, value);
	}

	/// <summary>"What's New" for the version the window names, if it has notes.</summary>
	public ReleaseNotes? Notes
	{
		get => _notes;
		private set => SetProperty(ref _notes, value);
	}

	public bool NotesExpanded
	{
		get => _notesExpanded;
		set => SetProperty(ref _notesExpanded, value);
	}

	public IRelayCommand PrimaryCommand { get; }
	public IRelayCommand SecondaryCommand { get; }

	public void Start()
	{
		if (UpdateChecker.IsSupported) _timer.Start();
	}

	public async Task CheckForUpdatesAsync()
	{
		if (_sessionActive)
		{
			_window?.Activate();
			return;
		}
		SetSessionActive(true);
		// The check itself can't be interrupted, so Cancel ends the session at once and the
		// late result is dropped.
		var cancelled = false;
		void Cancel()
		{
			cancelled = true;
			EndSession();
		}
		Present("Checking for updates…", "Looking for a newer version of Umbrel.", progress: true,
			secondary: ("Cancel", Cancel), onClose: Cancel);

		var result = await UpdateChecker.CheckAsync();
		// Up to date, the notes are for the installed version, as on macOS: what's new in
		// the version the user already has.
		var notes = result.Status switch
		{
			UpdateCheckStatus.Available => await NotesAsync(result.Version),
			UpdateCheckStatus.UpToDate => await NotesAsync(CurrentPackageVersion),
			_ => null,
		};
		if (cancelled)
		{
			if (result.Status == UpdateCheckStatus.Available) SetAvailableVersion(result.Version);
			return;
		}
		switch (result.Status)
		{
			case UpdateCheckStatus.Available:
				SetAvailableVersion(result.Version);
				PresentAvailable(result, notes);
				break;
			case UpdateCheckStatus.UpToDate:
				SetAvailableVersion(null);
				PresentNotice("You’re up to date!", $"Umbrel {App.DisplayVersion} is currently the newest version available.", notes);
				break;
			case UpdateCheckStatus.NotSupported:
				PresentNotice("Software update is unavailable", "This copy of Umbrel wasn’t installed with App Installer, so it can’t check for updates.");
				break;
			default:
				PresentNotice("An error occurred in retrieving update information. Please try again later.", null);
				break;
		}
	}

	private async Task CheckInBackgroundAsync()
	{
		// A manual check or install already owns the window.
		if (_sessionActive) return;
		var result = await UpdateChecker.CheckAsync();
		if (result.Status == UpdateCheckStatus.UpToDate) SetAvailableVersion(null);
		if (result.Status != UpdateCheckStatus.Available || result.Version is null) return;
		SetAvailableVersion(result.Version);
		if (_sessionActive) return;

		// Present each version at most once. Manual checks skip this gate. Saved before
		// showing, so exiting or installing also counts as the one presentation.
		var settings = AppSettings.Load();
		var key = result.Version.ToString();
		if (settings.AutomaticallyPresentedUpdateVersion == key) return;
		settings.AutomaticallyPresentedUpdateVersion = key;
		settings.Save();

		SetSessionActive(true);
		// Fetched only for a prompt that will show, not on every background check.
		var notes = await NotesAsync(result.Version);
		PresentAvailable(result, notes);
	}

	private void PresentAvailable(UpdateCheckResult result, ReleaseNotes? notes)
	{
		Present($"Version {result.DisplayVersion} is available.", $"You’re currently using version {App.DisplayVersion}.",
			primary: ("Install update", () => _ = InstallAsync()),
			secondary: ("Not now", EndSession),
			onClose: EndSession,
			notes: notes);
	}

	// Titled with the version the notes describe, matching the version named in the line
	// above it, so the section never reads as new compared to something else.
	private static async Task<ReleaseNotes?> NotesAsync(Version? version) =>
		version is not null && await UpdateChecker.ReleaseNotesAsync(version) is { } text
			? ReleaseNotes.Parse($"What’s New in {version.ToString(3)}", text)
			: null;

	private async Task InstallAsync()
	{
		var cancellation = new CancellationTokenSource();
		// Closing the window leaves the install running; only Cancel stops it. Windows also
		// closes this window when it shuts Umbrel down to finish the update.
		Present("Installing update…", "Umbrel will reopen when the update is complete.", progress: true,
			secondary: ("Cancel", cancellation.Cancel), onClose: () => { });

		var progress = new Progress<double>(value =>
		{
			if (value <= 0) return;
			IsIndeterminate = false;
			Progress = value;
		});
		bool installed;
		try
		{
			installed = await UpdateChecker.InstallAsync(progress, cancellation.Token);
		}
		catch (OperationCanceledException)
		{
			EndSession();
			return;
		}
		if (installed)
		{
			SetAvailableVersion(null);
			PresentNotice("Umbrel was updated", "The update was installed successfully.");
		}
		else
		{
			PresentNotice("An error occurred while installing the update. Please try again later.", null);
		}
	}

	// The package version is kept rather than the display one so it compares with this build.
	private void SetAvailableVersion(Version? version)
	{
		AvailableVersion = version?.ToString(3);
		var settings = AppSettings.Load();
		settings.AvailableUpdateVersion = version?.ToString();
		settings.Save();
	}

	// A saved update stops counting once this build is that version or newer, so an install
	// that Windows finishes by relaunching Umbrel clears it.
	private static string? RestoredAvailableVersion()
	{
		var settings = AppSettings.Load();
		if (Version.TryParse(settings.AvailableUpdateVersion, out var version) && version > CurrentPackageVersion)
		{
			return version.ToString(3);
		}
		if (settings.AvailableUpdateVersion is not null)
		{
			settings.AvailableUpdateVersion = null;
			settings.Save();
		}
		return null;
	}

	// Equal to the package identity version (see Umbrel.csproj), the version the update feed lists.
	private static Version? CurrentPackageVersion => Assembly.GetExecutingAssembly().GetName().Version;

	private void PresentNotice(string title, string? message, ReleaseNotes? notes = null) =>
		Present(title, message, primary: ("OK", EndSession), onClose: EndSession, notes: notes);

	private void Present(
		string title,
		string? message,
		bool progress = false,
		(string Title, Action Action)? primary = null,
		(string Title, Action Action)? secondary = null,
		Action? onClose = null,
		ReleaseNotes? notes = null)
	{
		Title = title;
		Message = message;
		Notes = notes;
		// Collapsed each time, so the window keeps its compact size (macOS update window).
		NotesExpanded = false;
		ShowsProgress = progress;
		IsIndeterminate = progress;
		Progress = 0;
		PrimaryButton = primary?.Title;
		_primaryAction = primary?.Action;
		SecondaryButton = secondary?.Title;
		_secondaryAction = secondary?.Action;
		_closeAction = onClose;
		ButtonsEnabled = true;

		if (_window is null)
		{
			_window = new UpdateWindow(this);
			_window.Closed += (_, _) =>
			{
				_window = null;
				var close = _closeAction;
				_closeAction = null;
				close?.Invoke();
			};
			_window.Show();
		}
		_window.Activate();
	}

	// Buttons act once, like the macOS window: a second click can't reply twice.
	private void Perform(Action? action)
	{
		if (action is null || !ButtonsEnabled) return;
		ButtonsEnabled = false;
		action();
	}

	private void EndSession()
	{
		_closeAction = null;
		SetSessionActive(false);
		_window?.Close();
	}

	private void SetSessionActive(bool active)
	{
		_sessionActive = active;
		OnPropertyChanged(nameof(CanCheckForUpdates));
	}
}
