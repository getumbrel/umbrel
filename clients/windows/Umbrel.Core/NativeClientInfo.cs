using System.Reflection;

namespace Umbrel.Core;

/// <summary>
/// Client details reported with every native login and access refresh so app and OS
/// updates never leave stale details on the server's long-lived native session.
/// Built from the entry assembly, Umbrel.exe.
/// </summary>
public sealed record NativeClientInfo(
	string Id,
	string Platform,
	string DeviceClass,
	string AppVersion,
	string AppBuild,
	string OsVersion)
{
	public static NativeClientInfo Current { get; } = FromEntryAssembly();

	private static NativeClientInfo FromEntryAssembly()
	{
		var assembly = Assembly.GetEntryAssembly();
		var informational = assembly?.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;
		var version = assembly?.GetName().Version;
		var appVersion = string.IsNullOrWhiteSpace(informational)
			? version is null ? "unknown" : $"{version.Major}.{version.Minor}.{version.Build}"
			: informational.Split('+')[0];
		var appBuild = version is null ? "unknown" : version.Revision.ToString();
		var os = Environment.OSVersion.Version;
		return new NativeClientInfo(
			Id: "umbrel",
			Platform: "windows",
			DeviceClass: "desktop",
			AppVersion: appVersion,
			AppBuild: appBuild,
			OsVersion: $"{os.Major}.{os.Minor}.{os.Build}");
	}
}
