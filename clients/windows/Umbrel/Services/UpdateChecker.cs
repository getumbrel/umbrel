using System.Diagnostics;
using System.Net;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Xml.Linq;
using Windows.ApplicationModel;
using Windows.Management.Deployment;

namespace Umbrel.Services;

public enum UpdateCheckStatus
{
	UpToDate,
	Available,
	NotSupported,
	Failed,
}

/// <param name="Version">The feed's four-part package version; set when an update is available.</param>
public sealed record UpdateCheckResult(UpdateCheckStatus Status, Version? Version = null)
{
	/// <summary>Major.Minor.Build, the marketing version (see Umbrel.csproj).</summary>
	public string? DisplayVersion => Version is null ? null : Version.ToString(3);
}

/// <summary>
/// Updates come from the App Installer file the package was installed from (see
/// Umbrel.appinstaller). That file has no UpdateSettings, so Windows never updates on
/// its own and Umbrel asks first, as the macOS app does. Both steps use the App Installer
/// APIs: Package.CheckUpdateAvailabilityAsync to check and
/// PackageManager.AddPackageByAppInstallerFileAsync to install. Unpackaged development
/// builds and packages installed without the App Installer file can't update.
/// </summary>
public static partial class UpdateChecker
{
	private const uint RESTART_NO_CRASH = 1;
	private const uint RESTART_NO_HANG = 2;
	private const uint RESTART_NO_REBOOT = 8;

	// The feed and the release notes are a few KB. The cap stops an oversized file from
	// tying up memory or the notes parser, which runs on the UI thread.
	private static readonly HttpClient Http = new()
	{
		Timeout = TimeSpan.FromSeconds(30),
		MaxResponseContentBufferSize = 64 * 1024,
	};
	private static readonly TimeSpan ReleaseNotesTimeout = TimeSpan.FromSeconds(5);

	public static bool IsSupported => StartupManager.IsPackaged && AppInstallerUri() is not null;

	// PackageManager calls do slow work, such as reading the package database or fetching
	// the App Installer file, before they return an operation to await, and a first request
	// through the system proxy can look the proxy up synchronously. So these run on the
	// thread pool, as Microsoft's App Installer sample and the Windows App SDK do, and the
	// UI thread only awaits them.
	public static Task<UpdateCheckResult> CheckAsync() => Task.Run(CheckInBackgroundAsync);

	public static Task<bool> InstallAsync(IProgress<double> progress, CancellationToken cancellation) =>
		Task.Run(() => InstallInBackgroundAsync(progress, cancellation));

	public static Task<string?> ReleaseNotesAsync(Version version) =>
		Task.Run(() => ReleaseNotesInBackgroundAsync(version));

	private static async Task<UpdateCheckResult> CheckInBackgroundAsync()
	{
		if (!StartupManager.IsPackaged) return new UpdateCheckResult(UpdateCheckStatus.NotSupported);
		try
		{
			// The reference documents that calling this on Package.Current fails with
			// "Access denied"; look the package up through PackageManager instead.
			var package = new PackageManager().FindPackageForUser(string.Empty, Package.Current.Id.FullName);
			if (package is null) return new UpdateCheckResult(UpdateCheckStatus.Failed);
			// A token from a live source keeps the operation referenced until it completes.
			// Without one, the projection can let it be collected and the await never returns
			// (microsoft/CsWinRT#1720, fixed after CsWinRT 2.3.1).
			using var keepAlive = new CancellationTokenSource();
			var result = await package.CheckUpdateAvailabilityAsync().AsTask(keepAlive.Token);
			switch (result.Availability)
			{
				case PackageUpdateAvailability.NoUpdates:
					return new UpdateCheckResult(UpdateCheckStatus.UpToDate);
				case PackageUpdateAvailability.Unknown:
					return new UpdateCheckResult(UpdateCheckStatus.NotSupported);
				case PackageUpdateAvailability.Available or PackageUpdateAvailability.Required:
					// The availability result carries no version, and the window names one.
					var version = await FeedVersionAsync();
					return version is null
						? new UpdateCheckResult(UpdateCheckStatus.Failed)
						: new UpdateCheckResult(UpdateCheckStatus.Available, version);
				default:
					Trace.TraceWarning("Update check failed: {0}", result.ExtendedError is { } error ? FileLog.Describe(error) : "no error");
					return new UpdateCheckResult(UpdateCheckStatus.Failed);
			}
		}
		catch (Exception ex)
		{
			Trace.TraceWarning("Update check failed: {0}", FileLog.Describe(ex));
			return new UpdateCheckResult(UpdateCheckStatus.Failed);
		}
	}

	/// <summary>
	/// Downloads and installs the update through the App Installer file. Windows closes
	/// Umbrel to register the new version, so on success this normally never returns;
	/// returning true means the update was installed without closing the app. The token
	/// must come from a live source: it also keeps the operation referenced until it
	/// completes (see CheckInBackgroundAsync).
	/// </summary>
	private static async Task<bool> InstallInBackgroundAsync(IProgress<double> progress, CancellationToken cancellation)
	{
		var uri = AppInstallerUri();
		if (uri is null) return false;
		try
		{
			// A packaged desktop app is only reopened after an update if it registered for
			// restart first. The flags limit that to updates, not crashes or hangs.
			_ = RegisterApplicationRestart(null, RESTART_NO_CRASH | RESTART_NO_HANG | RESTART_NO_REBOOT);
			var manager = new PackageManager();
			var result = await manager
				.AddPackageByAppInstallerFileAsync(uri, AddPackageByAppInstallerOptions.ForceTargetAppShutdown, manager.GetDefaultPackageVolume())
				.AsTask(cancellation, new Progress<DeploymentProgress>(value => progress.Report(value.percentage / 100.0)));
			if (result.ExtendedErrorCode is null) return true;
			Trace.TraceWarning("Update install failed: {0}", FileLog.Describe(result.ExtendedErrorCode));
			return false;
		}
		catch (OperationCanceledException)
		{
			throw;
		}
		catch (Exception ex)
		{
			Trace.TraceWarning("Update install failed: {0}", FileLog.Describe(ex));
			return false;
		}
	}

	private static Uri? AppInstallerUri()
	{
		if (!StartupManager.IsPackaged) return null;
		try
		{
			return Package.Current.GetAppInstallerInfo()?.Uri;
		}
		catch (Exception)
		{
			return null;
		}
	}

	/// <summary>
	/// The Markdown notes uploaded next to a version's package (Umbrel-0.1.0.1.md), or null
	/// when there are none. App Installer files have no field for notes, so they sit beside
	/// the feed and are protected by HTTPS alone, unlike the macOS notes, which the signed
	/// appcast carries. That's why ReleaseNotes never makes their links clickable.
	/// </summary>
	private static async Task<string?> ReleaseNotesInBackgroundAsync(Version version)
	{
		var feed = AppInstallerUri();
		if (feed is null || feed.Scheme != Uri.UriSchemeHttps) return null;
		try
		{
			// Short, so slow or missing notes never hold up the update window for long.
			using var timeout = new CancellationTokenSource(ReleaseNotesTimeout);
			using var response = await Http.GetAsync(new Uri(feed, $"Umbrel-{version}.md"), timeout.Token);
			// A release without notes is normal; the window then shows none.
			if (response.StatusCode == HttpStatusCode.NotFound) return null;
			response.EnsureSuccessStatusCode();
			var text = (await response.Content.ReadAsStringAsync(timeout.Token)).Trim();
			return text.Length == 0 ? null : text;
		}
		catch (Exception ex)
		{
			Trace.TraceWarning("Release notes unavailable: {0}", FileLog.Describe(ex));
			return null;
		}
	}

	/// <summary>The main package version listed in the App Installer file.</summary>
	private static async Task<Version?> FeedVersionAsync()
	{
		var uri = AppInstallerUri();
		if (uri is null) return null;
		var feed = XDocument.Parse(await Http.GetStringAsync(uri));
		var main = feed.Root?.Elements().FirstOrDefault(element => element.Name.LocalName is "MainPackage" or "MainBundle");
		return Version.TryParse(main?.Attribute("Version")?.Value, out var version) ? version : null;
	}

	[LibraryImport("kernel32.dll", StringMarshalling = StringMarshalling.Utf16)]
	private static partial int RegisterApplicationRestart(string? commandLine, uint flags);
}
