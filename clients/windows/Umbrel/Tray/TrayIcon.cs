using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using Umbrel.Interop;
using Umbrel.Services;
using Umbrel.ViewModels;

namespace Umbrel.Tray;

/// <summary>
/// The notification-area icon, driven directly through Shell_NotifyIcon with
/// NOTIFYICON_VERSION_4 so left click, keyboard select, and context-menu requests
/// arrive as distinct events with anchor coordinates. A hidden top-level tool window
/// receives the callbacks and two broadcasts that a message-only window would miss:
/// TaskbarCreated after an Explorer restart, when the icon is added again, and
/// WM_SETTINGCHANGE, when the glyph is matched to the Windows colour mode again.
/// </summary>
public sealed class TrayIcon : IDisposable
{
	private const uint IconId = 1;
	private const uint CallbackMessage = NativeMethods.WM_APP + 1;
	private const int WM_SETTINGCHANGE = 0x001A;
	private const int WS_POPUP = unchecked((int)0x80000000);
	private const int WS_EX_TOOLWINDOW = 0x80;

	private readonly AppState _state;
	private readonly PopupWindow _panel;
	private readonly ShellViewModel _shell;
	private readonly HwndSource _source;
	private readonly uint _taskbarCreatedMessage;
	private IntPtr _icon;
	private bool _added;
	private bool _alert;
	private bool _dark;
	private bool _disposed;
	private LaunchAtLoginStatus _launchAtLogin = LaunchAtLoginStatus.Disabled;

	public TrayIcon(AppState state, PopupWindow panel, ShellViewModel shell)
	{
		_state = state;
		_panel = panel;
		_shell = shell;
		var parameters = new HwndSourceParameters("UmbrelTrayWindow")
		{
			WindowStyle = WS_POPUP,
			ExtendedWindowStyle = WS_EX_TOOLWINDOW,
			Width = 0,
			Height = 0,
			PositionX = 0,
			PositionY = 0,
		};
		_source = new HwndSource(parameters);
		_source.AddHook(WndProc);
		_taskbarCreatedMessage = NativeMethods.RegisterWindowMessageW("TaskbarCreated");
		_dark = SystemTheme.IsDarkMode();
		_alert = _state.ShowsAlertIcon;
		Add();

		_state.PropertyChanged += (_, e) =>
		{
			if (e.PropertyName is nameof(AppState.ShowsAlertIcon) or null) Refresh();
		};
		_state.Notification += ShowBalloon;
		_ = RefreshLaunchAtLoginAsync();
	}

	/// <summary>The icon's rectangle in physical screen pixels, or null when unknown.</summary>
	internal NativeMethods.RECT? IconRect()
	{
		var identifier = new NativeMethods.NOTIFYICONIDENTIFIER
		{
			cbSize = (uint)Marshal.SizeOf<NativeMethods.NOTIFYICONIDENTIFIER>(),
			hWnd = _source.Handle,
			uID = IconId,
		};
		if (NativeMethods.Shell_NotifyIconGetRect(ref identifier, out var rect) != 0) return null;
		if (rect.right <= rect.left || rect.bottom <= rect.top) return null;
		return rect;
	}

	// No permission request as on macOS: Windows shows these unless the user turns off
	// Umbrel's notifications in Settings.
	public void ShowBalloon(string title, string body)
	{
		if (!_added) return;
		var data = BaseData();
		data.uFlags = NativeMethods.NIF_INFO;
		data.SetInfoTitle(title);
		data.SetInfo(body);
		data.dwInfoFlags = NativeMethods.NIIF_INFO;
		NativeMethods.Shell_NotifyIconW(NativeMethods.NIM_MODIFY, ref data);
	}

	private void Add()
	{
		ReloadIcon();
		var data = BaseData();
		data.uFlags = NativeMethods.NIF_MESSAGE | NativeMethods.NIF_ICON | NativeMethods.NIF_TIP | NativeMethods.NIF_SHOWTIP;
		data.uCallbackMessage = CallbackMessage;
		data.hIcon = _icon;
		data.SetTip("Umbrel");
		if (!NativeMethods.Shell_NotifyIconW(NativeMethods.NIM_ADD, ref data)) return;
		// NIM_SETVERSION must follow every NIM_ADD.
		data.uTimeoutOrVersion = NativeMethods.NOTIFYICON_VERSION_4;
		NativeMethods.Shell_NotifyIconW(NativeMethods.NIM_SETVERSION, ref data);
		_added = true;
	}

	private void Refresh()
	{
		if (_disposed) return;
		var dark = SystemTheme.IsDarkMode();
		var alert = _state.ShowsAlertIcon;
		if (dark == _dark && alert == _alert && _icon != IntPtr.Zero) return;
		_dark = dark;
		_alert = alert;
		ReloadIcon();
		if (!_added) return;
		var data = BaseData();
		data.uFlags = NativeMethods.NIF_ICON;
		data.hIcon = _icon;
		NativeMethods.Shell_NotifyIconW(NativeMethods.NIM_MODIFY, ref data);
	}

	private void ReloadIcon()
	{
		var previous = _icon;
		var file = (_alert, _dark) switch
		{
			(true, true) => "tray-alert-light.ico",
			(true, false) => "tray-alert-dark.ico",
			(false, true) => "tray-light.ico",
			(false, false) => "tray-dark.ico",
		};
		var path = Path.Combine(AppContext.BaseDirectory, "Assets", file);
		var cx = NativeMethods.GetSystemMetrics(NativeMethods.SM_CXSMICON);
		var cy = NativeMethods.GetSystemMetrics(NativeMethods.SM_CYSMICON);
		var loaded = NativeMethods.LoadImageW(IntPtr.Zero, path, NativeMethods.IMAGE_ICON, cx, cy, NativeMethods.LR_LOADFROMFILE);
		if (loaded == IntPtr.Zero) return;
		_icon = loaded;
		if (previous != IntPtr.Zero) NativeMethods.DestroyIcon(previous);
	}

	private NativeMethods.NOTIFYICONDATAW BaseData() => new()
	{
		cbSize = (uint)Marshal.SizeOf<NativeMethods.NOTIFYICONDATAW>(),
		hWnd = _source.Handle,
		uID = IconId,
	};

	private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
	{
		if (msg == CallbackMessage)
		{
			var eventId = (uint)(lParam.ToInt64() & 0xFFFF);
			var x = (short)(wParam.ToInt64() & 0xFFFF);
			var y = (short)((wParam.ToInt64() >> 16) & 0xFFFF);
			switch (eventId)
			{
				case NativeMethods.NIN_SELECT:
				case NativeMethods.NIN_KEYSELECT:
					_panel.Toggle();
					handled = true;
					break;
				case NativeMethods.WM_CONTEXTMENU:
					ShowContextMenu(x, y);
					handled = true;
					break;
			}
			return IntPtr.Zero;
		}
		// Broadcast after a system setting changes, with "ImmersiveColorSet" for a colour mode
		// change. Any change re-reads the mode, since some senders pass no area name, and
		// Refresh returns early when the glyph is already right. Posted so the sender isn't
		// held up while Explorer swaps the icon.
		if (msg == WM_SETTINGCHANGE)
		{
			_source.Dispatcher.BeginInvoke(Refresh);
			return IntPtr.Zero;
		}
		if (_taskbarCreatedMessage != 0 && msg == (int)_taskbarCreatedMessage)
		{
			// The new taskbar draws in the current colour mode, so match it before adding.
			_dark = SystemTheme.IsDarkMode();
			_added = false;
			Add();
			handled = true;
		}
		return IntPtr.Zero;
	}

	private const uint MenuAbout = 1;
	private const uint MenuUpdates = 2;
	private const uint MenuLaunchAtLogin = 3;
	private const uint MenuQuit = 4;

	// A normal shortcut menu drawn by Windows, as the notification area guidance asks and
	// like the Mac's NSMenu. The tray window must be foreground first or the menu won't
	// close on an outside click (TrackPopupMenuEx remarks).
	private void ShowContextMenu(int x, int y)
	{
		var updates = _shell.Updates;
		var menu = NativeMethods.CreatePopupMenu();
		try
		{
			AppendItem(menu, MenuAbout, "About Umbrel");
			AppendItem(menu, MenuUpdates, updates.AvailableVersion is null ? "Check for updates…" : "Update available…",
				enabled: updates.CanCheckForUpdates);
			NativeMethods.AppendMenuW(menu, NativeMethods.MF_SEPARATOR, 0, null);
			AppendItem(menu, MenuLaunchAtLogin, LaunchAtLoginTitle(_launchAtLogin),
				enabled: _launchAtLogin != LaunchAtLoginStatus.Unavailable,
				isChecked: _launchAtLogin == LaunchAtLoginStatus.Enabled);
			NativeMethods.AppendMenuW(menu, NativeMethods.MF_SEPARATOR, 0, null);
			AppendItem(menu, MenuQuit, "Exit");

			NativeMethods.SetForegroundWindow(_source.Handle);
			var align = NativeMethods.GetSystemMetrics(NativeMethods.SM_MENUDROPALIGNMENT) != 0
				? NativeMethods.TPM_RIGHTALIGN
				: NativeMethods.TPM_LEFTALIGN;
			var command = NativeMethods.TrackPopupMenuEx(menu,
				align | NativeMethods.TPM_BOTTOMALIGN | NativeMethods.TPM_RIGHTBUTTON | NativeMethods.TPM_RETURNCMD,
				x, y, _source.Handle, IntPtr.Zero);
			switch (command)
			{
				case MenuAbout:
					_shell.AboutCommand.Execute(null);
					break;
				case MenuUpdates:
					_shell.CheckForUpdatesCommand.Execute(null);
					break;
				case MenuLaunchAtLogin:
					_ = PerformLaunchAtLoginActionAsync();
					break;
				case MenuQuit:
					_shell.QuitCommand.Execute(null);
					break;
			}
		}
		finally
		{
			NativeMethods.DestroyMenu(menu);
		}
		// The menu shows the last known status rather than waiting on StartupTask; re-read
		// it so the next menu reflects a change made in Settings.
		_ = RefreshLaunchAtLoginAsync();
	}

	private static void AppendItem(IntPtr menu, uint id, string text, bool enabled = true, bool isChecked = false) =>
		NativeMethods.AppendMenuW(menu,
			NativeMethods.MF_STRING | (enabled ? 0 : NativeMethods.MF_GRAYED) | (isChecked ? NativeMethods.MF_CHECKED : 0),
			id, text);

	internal async Task RefreshLaunchAtLoginAsync() => _launchAtLogin = await StartupManager.StatusAsync();

	private static string LaunchAtLoginTitle(LaunchAtLoginStatus status) => status switch
	{
		LaunchAtLoginStatus.RequiresApproval => "Run at startup (turn on in Settings)…",
		LaunchAtLoginStatus.Unavailable => "Run at startup (unavailable)",
		_ => "Run at startup",
	};

	private async Task PerformLaunchAtLoginActionAsync()
	{
		switch (_launchAtLogin)
		{
			case LaunchAtLoginStatus.RequiresApproval:
				StartupManager.OpenStartupSettings();
				return;
			case LaunchAtLoginStatus.Enabled:
				await StartupManager.SetEnabledAsync(false);
				break;
			case LaunchAtLoginStatus.Disabled:
				await StartupManager.SetEnabledAsync(true);
				break;
		}
		await RefreshLaunchAtLoginAsync();
	}

	public void Dispose()
	{
		if (_disposed) return;
		_disposed = true;
		_state.Notification -= ShowBalloon;
		if (_added)
		{
			var data = BaseData();
			NativeMethods.Shell_NotifyIconW(NativeMethods.NIM_DELETE, ref data);
			_added = false;
		}
		if (_icon != IntPtr.Zero)
		{
			NativeMethods.DestroyIcon(_icon);
			_icon = IntPtr.Zero;
		}
		_source.RemoveHook(WndProc);
		_source.Dispose();
	}
}
