using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using Umbrel.ViewModels;

namespace Umbrel.Views;

public partial class StatusLine : UserControl
{
	public static readonly DependencyProperty StatusProperty = DependencyProperty.Register(
		nameof(Status), typeof(StatusInfo), typeof(StatusLine), new PropertyMetadata(null, OnStatusChanged));

	public static readonly DependencyProperty SecondaryProperty = DependencyProperty.Register(
		nameof(Secondary), typeof(string), typeof(StatusLine));

	// Like macOS, the spinner waits 400 ms so quick checks don't flash it.
	private readonly DispatcherTimer _progressDelay = new() { Interval = TimeSpan.FromMilliseconds(400) };

	public StatusLine()
	{
		InitializeComponent();
		_progressDelay.Tick += (_, _) =>
		{
			_progressDelay.Stop();
			Progress.Opacity = 1;
		};
	}

	public StatusInfo? Status
	{
		get => (StatusInfo?)GetValue(StatusProperty);
		set => SetValue(StatusProperty, value);
	}

	public string? Secondary
	{
		get => (string?)GetValue(SecondaryProperty);
		set => SetValue(SecondaryProperty, value);
	}

	private static void OnStatusChanged(DependencyObject sender, DependencyPropertyChangedEventArgs e)
	{
		var line = (StatusLine)sender;
		var wasShowing = (e.OldValue as StatusInfo)?.ShowsProgress == true;
		var showing = (e.NewValue as StatusInfo)?.ShowsProgress == true;
		if (showing == wasShowing) return;
		line._progressDelay.Stop();
		line.Progress.Opacity = 0;
		if (showing) line._progressDelay.Start();
	}
}
