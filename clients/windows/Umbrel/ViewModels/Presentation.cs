using System.IO;
using System.Windows;
using System.Windows.Media;
using Umbrel.Core;

namespace Umbrel.ViewModels;

/// <summary>Shared palette and status vocabulary, ported from the macOS Components.</summary>
public static class Palette
{
	// Same values as the macOS Palette; Theme.xaml repeats the ones XAML uses.
	public static readonly Brush Blue = Freeze("#0088FF");
	public static readonly Brush Green = Freeze("#34C759");
	public static readonly Brush Orange = Freeze("#FF9F0A");
	public static readonly Brush Red = Freeze("#FF2D55");
	public static readonly Brush Gray = Freeze("#8E8E93");

	private static Brush Freeze(string hex)
	{
		var brush = new SolidColorBrush((Color)ColorConverter.ConvertFromString(hex));
		brush.Freeze();
		return brush;
	}
}

public sealed record StatusInfo(string Text, Brush Color, bool ShowsProgress = false);

/// <summary>
/// Where a device image is drawn, as the macOS DeviceIconPlacement. The renders have very
/// different proportions, so each gets its own box per place, giving it about the area of
/// the Umbrel Home render there (the Pro keeps its larger box). The upright ROG stops at
/// about 1.4x the Home's height, and list rows keep their 45 px column so names line up.
/// </summary>
public enum DeviceIconPlacement
{
	ListRow,
	WelcomeCard,
	DetailHeader,
}

public static class Presentation
{
	public static string AssetPath(string file) => Path.Combine(AppContext.BaseDirectory, "Assets", file);

	public static string LogoPath => AssetPath("umbrel-logo.png");

	public static string AppIconPath => AssetPath("app-icon.png");

	public static string FolderPath => AssetPath("folder.png");

	public static string DeviceIcon(UmbrelDeviceKind kind) => kind switch
	{
		UmbrelDeviceKind.Home => AssetPath("umbrel-home.png"),
		UmbrelDeviceKind.Pro => AssetPath("umbrel-pro.png"),
		UmbrelDeviceKind.AsusNuc14Essential => AssetPath("system-asus-nuc-14-essential.png"),
		UmbrelDeviceKind.AsusNuc16Pro => AssetPath("system-asus-nuc-16-pro.png"),
		UmbrelDeviceKind.AsusRogNuc16 => AssetPath("system-asus-rog-nuc-16.png"),
		UmbrelDeviceKind.RaspberryPi => AssetPath("system-pi.png"),
		_ => AssetPath("system-generic-device.png"),
	};

	/// <summary>The same boxes as the macOS DeviceIconPlacement.size(for:).</summary>
	public static Size DeviceIconSize(DeviceIconPlacement placement, UmbrelDeviceKind kind) => (placement, kind) switch
	{
		(DeviceIconPlacement.ListRow, UmbrelDeviceKind.Home or UmbrelDeviceKind.Generic) => new Size(33, 31),
		(DeviceIconPlacement.ListRow, UmbrelDeviceKind.Pro) => new Size(45, 31),
		(DeviceIconPlacement.ListRow, UmbrelDeviceKind.RaspberryPi) => new Size(33, 33),
		(DeviceIconPlacement.ListRow, UmbrelDeviceKind.AsusNuc14Essential) => new Size(45, 17),
		(DeviceIconPlacement.ListRow, UmbrelDeviceKind.AsusNuc16Pro) => new Size(42, 19),
		(DeviceIconPlacement.ListRow, UmbrelDeviceKind.AsusRogNuc16) => new Size(17, 34),
		(DeviceIconPlacement.WelcomeCard, UmbrelDeviceKind.Home or UmbrelDeviceKind.RaspberryPi or UmbrelDeviceKind.Generic) => new Size(108, 80),
		(DeviceIconPlacement.WelcomeCard, UmbrelDeviceKind.Pro) => new Size(162, 99),
		(DeviceIconPlacement.WelcomeCard, UmbrelDeviceKind.AsusNuc14Essential) => new Size(151, 56),
		(DeviceIconPlacement.WelcomeCard, UmbrelDeviceKind.AsusNuc16Pro) => new Size(139, 61),
		(DeviceIconPlacement.WelcomeCard, UmbrelDeviceKind.AsusRogNuc16) => new Size(56, 110),
		(DeviceIconPlacement.DetailHeader, UmbrelDeviceKind.Home or UmbrelDeviceKind.RaspberryPi or UmbrelDeviceKind.Generic) => new Size(62, 46),
		(DeviceIconPlacement.DetailHeader, UmbrelDeviceKind.Pro) => new Size(80, 57),
		(DeviceIconPlacement.DetailHeader, UmbrelDeviceKind.AsusNuc14Essential) => new Size(87, 32),
		(DeviceIconPlacement.DetailHeader, UmbrelDeviceKind.AsusNuc16Pro) => new Size(80, 35),
		(DeviceIconPlacement.DetailHeader, UmbrelDeviceKind.AsusRogNuc16) => new Size(32, 63),
		_ => throw new InvalidOperationException(),
	};

	/// <summary>Evaluated in the same order as the macOS statusInfo(for:), with Can't verify
	/// ahead of Offline as on iOS.</summary>
	public static StatusInfo Status(Device device) => device.Connection switch
	{
		ConnectionState.Connecting => new StatusInfo("Connecting…", Palette.Orange),
		ConnectionState.Disconnecting => new StatusInfo("Disconnecting…", Palette.Orange),
		_ when device.Saved && device.Reachability == DeviceReachability.Unverified => new StatusInfo("", Palette.Gray, ShowsProgress: true),
		_ when device.Saved && !device.Online && device.IdentityChanged => new StatusInfo(IdentityChange.Status, Palette.Red),
		_ when device.Saved && !device.Online => new StatusInfo("Offline", Palette.Red),
		_ when !device.Saved => new StatusInfo(device.Onboarded == true ? "Ready to connect" : "Ready for setup", Palette.Blue),
		ConnectionState.Connected => new StatusInfo("Connected", Palette.Green),
		ConnectionState.Expired => new StatusInfo("Session expired", Palette.Orange),
		_ => new StatusInfo("Disconnected", Palette.Red),
	};

	/// <summary>The connected route, as the macOS connectionRouteLabel(for:); null until a host is verified.</summary>
	public static string? RouteLabel(Device device, string? connectionHost) =>
		device.Connection != ConnectionState.Connected || connectionHost is null ? null
		: SavedDevice.IsTailscaleAddress(connectionHost) ? "Tailscale" : "Local network";
}
