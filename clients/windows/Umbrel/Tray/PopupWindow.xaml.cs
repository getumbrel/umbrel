using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using Umbrel.Interop;
using Umbrel.ViewModels;
using Umbrel.Core;

namespace Umbrel.Tray;

/// <summary>
/// The 420-wide panel (in DIPs) that drops down from the tray icon. It never shows in
/// the taskbar, closes when it loses activation (except while a connect or mount is in
/// progress and Windows may be showing its own dialogs), and starts a probe sweep (with
/// its 30 s cooldown) when it opens.
/// </summary>
public partial class PopupWindow : Window
{
	private readonly ShellViewModel _shell;
	private readonly AppState _state;
	private TrayIcon? _tray;

	public PopupWindow(ShellViewModel shell, AppState state)
	{
		InitializeComponent();
		_shell = shell;
		_state = state;
		DataContext = shell;
		Deactivated += OnDeactivated;
		PreviewKeyDown += OnPreviewKeyDown;
		PreviewMouseDown += OnPreviewMouseDown;
		IsVisibleChanged += OnIsVisibleChanged;
		Closing += OnClosing;
		shell.PropertyChanged += OnShellChanged;
		state.PropertyChanged += OnStateChanged;
		// Border rounds only its own background, so the scroll bar and the status badge's
		// rings would square off the corners. Clip like SectionBox.
		PanelShape.SizeChanged += (_, e) =>
		{
			var radius = PanelShape.CornerRadius.TopLeft;
			PanelShape.Clip = new RectangleGeometry(new Rect(e.NewSize), radius, radius);
		};
	}

	protected override void OnSourceInitialized(EventArgs e)
	{
		base.OnSourceInitialized(e);
		HwndSource.FromHwnd(new WindowInteropHelper(this).Handle).AddHook(KeepAnchored);
	}

	// SizeToContent resizes with SWP_NOMOVE, so re-anchoring afterwards takes a second
	// move and the panel visibly jumps. Fold the move into that same resize instead.
	private IntPtr KeepAnchored(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
	{
		if (msg != NativeMethods.WM_WINDOWPOSCHANGING) return IntPtr.Zero;
		// Mid-slide, keep the animated position; the slide re-anchors when it ends.
		if (HasAnimatedProperties) return IntPtr.Zero;
		var pos = Marshal.PtrToStructure<NativeMethods.WINDOWPOS>(lParam);
		if ((pos.flags & NativeMethods.SWP_NOSIZE) != 0) return IntPtr.Zero;
		if (PresentationSource.FromVisual(this)?.CompositionTarget is not { } target) return IntPtr.Zero;
		var size = target.TransformFromDevice.Transform(new Vector(pos.cx, pos.cy));
		var origin = target.TransformToDevice.Transform(Placement(size.X, size.Y));
		pos.x = (int)Math.Round(origin.X);
		pos.y = (int)Math.Round(origin.Y);
		pos.flags &= ~NativeMethods.SWP_NOMOVE;
		Marshal.StructureToPtr(pos, lParam, false);
		return IntPtr.Zero;
	}

	public void AttachTray(TrayIcon tray) => _tray = tray;

	public void Toggle()
	{
		// If the tray click already deactivated the panel, its slide down is that click's
		// dismissal; don't reopen.
		if (_closing) return;
		if (IsVisible) Dismiss();
		else Present();
	}

	public void Present()
	{
		var slideIn = (!IsVisible || _closing) && SystemParameters.ClientAreaAnimation;
		_closing = false;
		BeginAnimation(TopProperty, null);
		_shell.PanelWillPresent();
		new WindowInteropHelper(this).EnsureHandle(); // DPI transforms need the HWND on first open
		UpdateAnchor();
		FitToWorkArea();
		Layout();
		if (slideIn) Top = HiddenTop();
		Show();
		Activate();
		if (slideIn) Slide(Placement(ActualWidth, ActualHeight).Y, DirectEntrance, OpenDuration, () => Layout());
		else Layout();
		_state.PanelDidOpen();
		QueueConfigStorageAlert();
	}

	// Taskbar flyouts slide up from behind the taskbar and back down when dismissed
	// (Windows motion guidance). Curves and durations are its Direct Entrance and Gentle
	// Exit, which Quick Settings uses on Windows 11. No fade, like Quick Settings.
	// Skipped when the user turns off Animation effects.
	private static readonly KeySpline DirectEntrance = Frozen(new KeySpline(0, 0, 0, 1));
	private static readonly KeySpline GentleExit = Frozen(new KeySpline(1, 0, 1, 1));
	private static readonly TimeSpan OpenDuration = TimeSpan.FromMilliseconds(250);
	private static readonly TimeSpan CloseDuration = TimeSpan.FromMilliseconds(167);
	private bool _closing;

	private static KeySpline Frozen(KeySpline spline)
	{
		spline.Freeze();
		return spline;
	}

	// A modal dialog the panel owns (an alert, or the HTTPS or open-files confirm)
	// disables the panel while it's up. Stay open behind it, as the macOS panel does for its
	// sheets; hiding would leave the dialog on screen by itself.
	private bool ShowsOwnedDialog => !NativeMethods.IsWindowEnabled(new WindowInteropHelper(this).Handle);

	private void Dismiss()
	{
		if (!IsVisible || _closing || ShowsOwnedDialog) return;
		if (!SystemParameters.ClientAreaAnimation)
		{
			Hide();
			return;
		}
		_closing = true;
		Slide(HiddenTop(), GentleExit, CloseDuration, () => Hide());
	}

	// Each completion checks that no newer open or close took over meanwhile.
	private void Slide(double to, KeySpline easing, TimeSpan duration, Action completed)
	{
		var closing = _closing;
		var animation = new DoubleAnimationUsingKeyFrames { FillBehavior = FillBehavior.Stop };
		animation.KeyFrames.Add(new SplineDoubleKeyFrame(to, KeyTime.FromTimeSpan(duration), easing));
		animation.Completed += (_, _) =>
		{
			if (_closing != closing) return;
			_closing = false;
			// A finished clock stays attached; remove it so the resize hook re-anchors again.
			BeginAnimation(TopProperty, null);
			completed();
		};
		BeginAnimation(TopProperty, animation);
	}

	// Just past the taskbar edge, where the taskbar covers the panel and its shadow.
	private double HiddenTop()
	{
		var work = WorkArea();
		return _taskbarAtTop ? work.Top - ActualHeight : work.Bottom;
	}

	// Fit the panel to the work area with the flyout gap at both ends; taller pages scroll.
	private void FitToWorkArea() =>
		MaxHeight = WorkArea().Height - 2 * FlyoutGap + Frame.Margin.Top + Frame.Margin.Bottom;

	// The same work area is fewer DIPs at a larger scale.
	protected override void OnDpiChanged(DpiScale oldDpi, DpiScale newDpi)
	{
		base.OnDpiChanged(oldDpi, newDpi);
		FitToWorkArea();
	}

	// Windows 11 flyouts sit centered on their button, 12 DIPs from the taskbar and
	// screen edges.
	private const double FlyoutGap = 12;

	// Captured when the panel opens: an icon in the "^" overflow moves once that popup closes.
	private double _anchorX;
	private bool _taskbarAtTop;
	private NativeMethods.RECT _workArea; // physical pixels, of the tray's monitor

	private void UpdateAnchor()
	{
		var icon = _tray?.IconRect();
		// The tray's monitor, or the primary one when the icon's position is unknown.
		var probe = icon ?? new NativeMethods.RECT { right = 1, bottom = 1 };
		var info = new NativeMethods.MONITORINFO { cbSize = (uint)Marshal.SizeOf<NativeMethods.MONITORINFO>() };
		if (NativeMethods.GetMonitorInfoW(NativeMethods.MonitorFromRect(ref probe, NativeMethods.MONITOR_DEFAULTTOPRIMARY), ref info))
		{
			_workArea = info.rcWork;
		}
		var work = WorkArea();
		// No icon rectangle: bottom-right, like the system flyouts.
		_anchorX = work.Right;
		_taskbarAtTop = false;
		if (icon is not { } rect) return;
		var center = FromDevice().Transform(new Point((rect.left + rect.right) / 2.0, (rect.top + rect.bottom) / 2.0));
		_anchorX = center.X;
		_taskbarAtTop = center.Y < work.Top;
	}

	// The window's current scale. SystemParameters.WorkArea isn't used: WPF converts it at
	// the scale the app started with, so after a scale change, or docking to a display with
	// another one, the panel would open off screen until a restart.
	private Matrix FromDevice() =>
		PresentationSource.FromVisual(this)?.CompositionTarget?.TransformFromDevice ?? Matrix.Identity;

	// The tray monitor's work area, in DIPs at the window's current scale.
	private Rect WorkArea()
	{
		var fromDevice = FromDevice();
		return new Rect(
			fromDevice.Transform(new Point(_workArea.left, _workArea.top)),
			fromDevice.Transform(new Point(_workArea.right, _workArea.bottom)));
	}

	// Top-left for a window of this size, in DIPs, placing the panel inside its shadow
	// margin. Measured from the taskbar, not the icon: an icon in the "^" overflow sits higher.
	private Point Placement(double width, double height)
	{
		var work = WorkArea();
		var margin = Frame.Margin;
		var panelWidth = width - margin.Left - margin.Right;
		var panelHeight = height - margin.Top - margin.Bottom;
		return new Point(
			Math.Max(work.Left + FlyoutGap, Math.Min(_anchorX - panelWidth / 2, work.Right - FlyoutGap - panelWidth)) - margin.Left,
			(_taskbarAtTop ? work.Top + FlyoutGap : Math.Max(work.Top + FlyoutGap, work.Bottom - FlyoutGap - panelHeight)) - margin.Top);
	}

	private void Layout()
	{
		var origin = Placement(ActualWidth > 0 ? ActualWidth : Width, ActualHeight > 0 ? ActualHeight : MinHeight);
		Left = origin.X;
		Top = origin.Y;
	}

	// A new page starts at its top, not at the last page's scroll offset.
	private void OnShellChanged(object? sender, PropertyChangedEventArgs e)
	{
		if (e.PropertyName == nameof(ShellViewModel.Current)) Scroller.ScrollToTop();
	}

	// Config storage problems show as an alert over whichever page is open. Posted, so the
	// alert's modal loop never runs inside a state change or Present.
	private void OnStateChanged(object? sender, PropertyChangedEventArgs e)
	{
		if (e.PropertyName is nameof(AppState.ConfigStorageIssue) or null) QueueConfigStorageAlert();
	}

	private bool _showingAlert;

	private void QueueConfigStorageAlert()
	{
		if (_state.ConfigStorageIssue is not null) Dispatcher.BeginInvoke(ShowConfigStorageAlert);
	}

	private void ShowConfigStorageAlert()
	{
		// While the panel is hidden the issue waits for the next Present.
		if (_showingAlert || !IsVisible || _closing) return;
		_showingAlert = true;
		try
		{
			while (_state.ConfigStorageIssue is { } issue)
			{
				MessageBox.Show(this, Config.Description(issue), Config.Title(issue), MessageBoxButton.OK, MessageBoxImage.Error);
				// An issue reported while this alert was open gets its own alert.
				if (_state.ConfigStorageIssue == issue) _state.DismissConfigStorageIssue();
			}
		}
		finally
		{
			_showingAlert = false;
		}
	}

	// Every way the panel closes ends in Hide.
	private void OnIsVisibleChanged(object sender, DependencyPropertyChangedEventArgs e)
	{
		if (!(bool)e.NewValue) _state.PanelDidClose();
	}

	private void OnDeactivated(object? sender, EventArgs e)
	{
		if (_state.HasForegroundActivity) return;
		Dismiss();
	}

	// The shadow is part of this window, so a click on it neither reaches the window below
	// nor deactivates the panel. Treat it as a click outside.
	private void OnPreviewMouseDown(object sender, MouseButtonEventArgs e)
	{
		if (!PanelShape.IsMouseOver) Dismiss();
	}

	private void OnPreviewKeyDown(object sender, KeyEventArgs e)
	{
		if (e.Key == Key.Escape)
		{
			Dismiss();
			e.Handled = true;
		}
	}

	private void OnClosing(object? sender, CancelEventArgs e)
	{
		// The window lives for the whole process; closing hides instead.
		if (Application.Current.ShutdownMode == ShutdownMode.OnExplicitShutdown && !_shell.IsQuitting)
		{
			e.Cancel = true;
			Hide();
		}
	}
}
