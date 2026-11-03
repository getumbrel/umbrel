using System.Diagnostics;
using System.Threading;
using System.Windows;
using System.Windows.Threading;
using Umbrel.Services;
using Umbrel.Tray;
using Umbrel.ViewModels;
using Umbrel.Core;

namespace Umbrel;

/// <summary>
/// A notification-area-only app: no main window, no taskbar button. The tray icon
/// owns the popup panel and the context menu; <see cref="AppState"/> owns the data.
/// </summary>
public partial class App : Application
{
	private const string SingleInstanceMutexName = @"Local\com.umbrel.windows";
	private const string ShowPanelEventName = @"Local\com.umbrel.windows.show-panel";

	private Mutex? _singleInstance;
	private EventWaitHandle? _showPanelSignal;
	private RegisteredWaitHandle? _showPanelWait;
	private AppState? _state;
	private TrayIcon? _tray;
	private PopupWindow? _panel;

	protected override void OnStartup(StartupEventArgs e)
	{
		base.OnStartup(e);

		// A second launch (Start menu, App Installer relaunch) asks the running
		// instance to open its panel instead of adding a second tray icon.
		_singleInstance = new Mutex(initiallyOwned: true, SingleInstanceMutexName, out var createdNew);
		_showPanelSignal = new EventWaitHandle(false, EventResetMode.AutoReset, ShowPanelEventName);
		if (!createdNew)
		{
			_showPanelSignal.Set();
			Shutdown();
			return;
		}

		FileLog.Start(Config.DefaultDirectory);
		DispatcherUnhandledException += OnDispatcherUnhandledException;

		var launchedAtStartup = StartupManager.WasLaunchedAtStartup(e.Args);
		_state = new AppState(Dispatcher);
		var launchAtLoginDefault = _state.RegisterLaunchAtLoginByDefaultIfNeededAsync();

		var shell = new ShellViewModel(_state);
		_panel = new PopupWindow(shell, _state);
		_tray = new TrayIcon(_state, _panel, shell);
		_panel.AttachTray(_tray);
		// The tray reads the startup state when it's created, which on a first run is
		// before the default above is applied, so its first menu would show it off.
		var tray = _tray;
		_ = Dispatcher.InvokeAsync(async () =>
		{
			await launchAtLoginDefault;
			await tray.RefreshLaunchAtLoginAsync();
		});
		shell.Updates.Start();

		_showPanelWait = ThreadPool.RegisterWaitForSingleObject(
			_showPanelSignal,
			(_, _) => Dispatcher.BeginInvoke(() => _panel.Present()),
			null,
			Timeout.Infinite,
			executeOnlyOnce: false);

		_state.Start();
		// The panel auto-opens on a manual launch only, never on a startup launch.
		if (!launchedAtStartup) _panel.Present();
	}

	protected override void OnExit(ExitEventArgs e)
	{
		_showPanelWait?.Unregister(null);
		_tray?.Dispose();
		_state?.Dispose();
		_showPanelSignal?.Dispose();
		if (_singleInstance is not null)
		{
			try
			{
				_singleInstance.ReleaseMutex();
			}
			catch (ApplicationException)
			{
			}
			_singleInstance.Dispose();
		}
		base.OnExit(e);
	}

	private void OnDispatcherUnhandledException(object sender, DispatcherUnhandledExceptionEventArgs e)
	{
		// Types and stack traces only, like the other log entries: exception messages can
		// carry host names and share paths.
		for (var error = e.Exception; error is not null; error = error.InnerException)
		{
			Trace.TraceError("Unhandled UI exception: {0}{1}{2}", FileLog.Describe(error), Environment.NewLine, error.StackTrace);
		}
		e.Handled = false;
	}

	public static string DisplayVersion => NativeClientInfo.Current.AppVersion;

	/// <summary>The fourth AssemblyVersion field, like CFBundleVersion on macOS.</summary>
	public static string BuildNumber => NativeClientInfo.Current.AppBuild;
}
