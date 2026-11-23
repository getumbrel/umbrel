using System.Diagnostics;
using System.Net;
using System.Net.Http;
using System.Runtime.InteropServices;
using Umbrel.Core;
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
/// Updates come from Umbrel's published App Installer file (see Umbrel.appinstaller). That
/// file has no UpdateSettings, so Windows never updates on its own and Umbrel asks first,
/// as the macOS app does. The app checks by reading the file itself, and the install
/// doesn't go through the file either, which isn't signed: the app takes the version and
/// package address from it (see UpdateFeed) and has Windows update from that package with
/// PackageManager.UpdatePackageAsync. Unpackaged development builds can't update.
/// </summary>
public static partial class UpdateChecker
{
	private const uint RESTART_NO_CRASH = 1;
	private const uint RESTART_NO_HANG = 2;
	private const uint RESTART_NO_REBOOT = 8;

	// The app reads the published feed itself rather than the address Windows recorded at
	// install: Windows doesn't always keep that address after an update (seen on Windows
	// 10), and a package installed straight from the .msix has none.
	private static readonly Uri FeedUri = new("https://download.umbrel.com/windows/Umbrel.appinstaller");

	// The feed and the release notes are a few KB. The cap stops an oversized file from
	// tying up memory or the notes parser, which runs on the UI thread.
	private static readonly HttpClient Http = new()
	{
		Timeout = TimeSpan.FromSeconds(30),
		MaxResponseContentBufferSize = 64 * 1024,
	};
	private static readonly TimeSpan ReleaseNotesTimeout = TimeSpan.FromSeconds(5);

	public static bool IsSupported => StartupManager.IsPackaged;

	// PackageManager calls do slow work, such as reading the package database, before they
	// return an operation to await, and a first request through the system proxy can look
	// the proxy up synchronously. So these run on the thread pool, as Microsoft's App
	// Installer sample and the Windows App SDK do, and the UI thread only awaits them.
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
			// A feed the install would refuse is a failed check, not an update to offer.
			var feed = await FeedAsync(CancellationToken.None);
			if (feed is null) return new UpdateCheckResult(UpdateCheckStatus.Failed);
			return feed.Version > InstalledVersion()
				? new UpdateCheckResult(UpdateCheckStatus.Available, feed.Version)
				: new UpdateCheckResult(UpdateCheckStatus.UpToDate);
		}
		catch (Exception ex)
		{
			Trace.TraceWarning("Update check failed: {0}", FileLog.Describe(ex));
			return new UpdateCheckResult(UpdateCheckStatus.Failed);
		}
	}

	/// <summary>
	/// Downloads and installs the package the feed names now, which may have changed since
	/// the check. Windows closes Umbrel to register the new version, so on success this
	/// normally never returns; returning true means the update was installed without
	/// closing the app. The token
	/// must come from a live source: it also keeps the operation referenced until it
	/// completes. Without one, the projection can let it be collected and the await never
	/// returns (microsoft/CsWinRT#1720, fixed after CsWinRT 2.3.1).
	/// </summary>
	private static async Task<bool> InstallInBackgroundAsync(IProgress<double> progress, CancellationToken cancellation)
	{
		try
		{
			var feed = await FeedAsync(cancellation);
			if (feed is null) return false;
			if (feed.Version <= InstalledVersion())
			{
				Trace.TraceWarning("Update install failed: the feed no longer offers a higher version");
				return false;
			}
			// A packaged desktop app is only reopened after an update if it registered for
			// restart first. The flags limit that to updates, not crashes or hangs.
			_ = RegisterApplicationRestart(null, RESTART_NO_CRASH | RESTART_NO_HANG | RESTART_NO_REBOOT);
			var manager = new PackageManager();
			// UpdatePackageAsync, not an Add call: Windows installs the download only if it is
			// a higher version of a package this user already has (documented, and seen on
			// Windows 11), and checks its signature as always. So whatever the address serves,
			// Umbrel can't be moved to an older version and nothing new gets installed.
			// Windows doesn't check that the package is Umbrel's, so the address could still
			// close and update another installed app, to a higher version Windows accepts
			// for that app.
			var result = await manager
				.UpdatePackageAsync(feed.PackageUri, null, DeploymentOptions.ForceTargetApplicationShutdown)
				.AsTask(cancellation, new Progress<DeploymentProgress>(value => progress.Report(value.percentage / 100.0)));
			if (result.ExtendedErrorCode is null) return true;
			Trace.TraceWarning("Update install failed: {0}", FileLog.Describe(result.ExtendedErrorCode));
			return false;
		}
		// Only the user's Cancel; a feed download that timed out is a failed install.
		catch (OperationCanceledException) when (cancellation.IsCancellationRequested)
		{
			throw;
		}
		catch (Exception ex)
		{
			Trace.TraceWarning("Update install failed: {0}", FileLog.Describe(ex));
			return false;
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
		if (!StartupManager.IsPackaged) return null;
		try
		{
			// Short, so slow or missing notes never hold up the update window for long.
			using var timeout = new CancellationTokenSource(ReleaseNotesTimeout);
			using var response = await Http.GetAsync(new Uri(FeedUri, $"Umbrel-{version}.md"), timeout.Token);
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

	/// <summary>
	/// What the published App Installer file offers this package, or null when the file is
	/// refused (see UpdateFeed).
	/// </summary>
	private static async Task<UpdateFeed?> FeedAsync(CancellationToken cancellation)
	{
		var id = Package.Current.Id;
		var feed = UpdateFeed.Parse(await Http.GetStringAsync(FeedUri, cancellation), id.Name, id.Publisher);
		if (feed is null) Trace.TraceWarning("Update feed refused");
		return feed;
	}

	private static Version InstalledVersion()
	{
		var version = Package.Current.Id.Version;
		return new Version(version.Major, version.Minor, version.Build, version.Revision);
	}

	[LibraryImport("kernel32.dll", StringMarshalling = StringMarshalling.Utf16)]
	private static partial int RegisterApplicationRestart(string? commandLine, uint flags);
}
