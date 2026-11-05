using System.Windows;
using System.Windows.Controls;
using System.Windows.Media.Imaging;
using Umbrel.ViewModels;
using Umbrel.Core;

namespace Umbrel.Views;

public partial class DeviceIcon : UserControl
{
	public static readonly DependencyProperty KindProperty = DependencyProperty.Register(
		nameof(Kind), typeof(UmbrelDeviceKind), typeof(DeviceIcon),
		new PropertyMetadata(UmbrelDeviceKind.Generic, (sender, _) => ((DeviceIcon)sender).UpdateKind()));

	public static readonly DependencyProperty PlacementProperty = DependencyProperty.Register(
		nameof(Placement), typeof(DeviceIconPlacement), typeof(DeviceIcon),
		new PropertyMetadata(DeviceIconPlacement.ListRow, (sender, _) => ((DeviceIcon)sender).UpdateSize()));

	public DeviceIcon()
	{
		InitializeComponent();
		SizeChanged += (_, _) => UpdateTile();
		UpdateKind();
	}

	public UmbrelDeviceKind Kind
	{
		get => (UmbrelDeviceKind)GetValue(KindProperty);
		set => SetValue(KindProperty, value);
	}

	public DeviceIconPlacement Placement
	{
		get => (DeviceIconPlacement)GetValue(PlacementProperty);
		set => SetValue(PlacementProperty, value);
	}

	private bool IsPi => Kind == UmbrelDeviceKind.RaspberryPi;

	private void UpdateKind()
	{
		var source = new BitmapImage(new Uri(Presentation.DeviceIcon(Kind)));
		Render.Source = IsPi ? null : source;
		PiMark.Source = IsPi ? source : null;
		Render.Visibility = IsPi ? Visibility.Collapsed : Visibility.Visible;
		PiTile.Visibility = IsPi ? Visibility.Visible : Visibility.Collapsed;
		UpdateSize();
		UpdateTile();
	}

	// Explicit width and height for the kind's box in this placement, as on macOS.
	private void UpdateSize()
	{
		var size = Presentation.DeviceIconSize(Placement, Kind);
		Width = size.Width;
		Height = size.Height;
	}

	// macOS proportions: square tile on the shorter side, 27/128 radius, mark at half size.
	private void UpdateTile()
	{
		if (!IsPi) return;
		var size = Math.Min(ActualWidth, ActualHeight);
		PiTile.Width = size;
		PiTile.Height = size;
		PiTile.CornerRadius = new CornerRadius(size * 27 / 128);
		PiMark.Width = size / 2;
		PiMark.Height = size / 2;
	}
}
