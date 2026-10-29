using System.IO;
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
		UmbrelDeviceKind.RaspberryPi => AssetPath("system-pi.png"),
		_ => AssetPath("system-generic-device.png"),
	};

	/// <summary>Evaluated in the same order as the macOS statusInfo(for:).</summary>
	public static StatusInfo Status(Device device) => device.Connection switch
	{
		ConnectionState.Connecting => new StatusInfo("Connecting…", Palette.Orange),
		ConnectionState.Disconnecting => new StatusInfo("Disconnecting…", Palette.Orange),
		_ when device.Saved && device.Reachability == DeviceReachability.Unverified => new StatusInfo("", Palette.Gray, ShowsProgress: true),
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
