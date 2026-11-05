using Microsoft.Win32;
using Umbrel.Interop;
using Windows.ApplicationModel;

namespace Umbrel.Services;

public enum LaunchAtLoginStatus
{
	Disabled,
	Enabled,
	RequiresApproval,
	Unavailable,
}

/// <summary>
/// Run at startup (launch at login). Packaged (MSIX) builds use the documented windows.startupTask
/// extension and the StartupTask API, which Windows surfaces on the Settings Startup
/// page and in Task Manager. Unpackaged builds fall back to the per-user Run key.
/// </summary>
public static class StartupManager
{
	public const string StartupTaskId = "UmbrelStartup";
	private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
	private const string RunValueName = "Umbrel";
	private const string StartupArgument = "--startup";

	public static bool IsPackaged { get; } = NativeMethods.HasPackageIdentity();

	/// <summary>
	/// The Run-key command carries an explicit flag. A packaged StartupTask activation
	/// arrives with ActivationKind.StartupTask instead.
	/// </summary>
	public static bool WasLaunchedAtStartup(string[] args)
	{
		if (args.Any(argument => string.Equals(argument, StartupArgument, StringComparison.Ordinal))) return true;
		if (!IsPackaged) return false;
		try
		{
			return AppInstance.GetActivatedEventArgs()?.Kind == Windows.ApplicationModel.Activation.ActivationKind.StartupTask;
		}
		catch (Exception)
		{
			return false;
		}
	}

	public static async Task<LaunchAtLoginStatus> StatusAsync()
	{
		if (IsPackaged)
		{
			try
			{
				var task = await StartupTask.GetAsync(StartupTaskId);
				return task.State switch
				{
					StartupTaskState.Enabled or StartupTaskState.EnabledByPolicy => LaunchAtLoginStatus.Enabled,
					// Turned off in Settings or Task Manager: RequestEnableAsync can't override
					// that, so the user re-enables it there, like macOS requiresApproval.
					StartupTaskState.DisabledByUser => LaunchAtLoginStatus.RequiresApproval,
					StartupTaskState.DisabledByPolicy => LaunchAtLoginStatus.Unavailable,
					_ => LaunchAtLoginStatus.Disabled,
				};
			}
			catch (Exception)
			{
				return LaunchAtLoginStatus.Unavailable;
			}
		}
		try
		{
			using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath, writable: false);
			return key?.GetValue(RunValueName) is string ? LaunchAtLoginStatus.Enabled : LaunchAtLoginStatus.Disabled;
		}
		catch (Exception)
		{
			return LaunchAtLoginStatus.Unavailable;
		}
	}

	/// <summary>Returns false when the change could not be applied.</summary>
	public static async Task<bool> SetEnabledAsync(bool enabled)
	{
		if (IsPackaged)
		{
			try
			{
				var task = await StartupTask.GetAsync(StartupTaskId);
				if (enabled)
				{
					var state = await task.RequestEnableAsync();
					return state is StartupTaskState.Enabled or StartupTaskState.EnabledByPolicy;
				}
				task.Disable();
				return true;
			}
			catch (Exception)
			{
				return false;
			}
		}
		try
		{
			using var key = Registry.CurrentUser.CreateSubKey(RunKeyPath, writable: true);
			if (enabled)
			{
				var executable = Environment.ProcessPath ?? throw new InvalidOperationException("Unknown executable path");
				key.SetValue(RunValueName, $"\"{executable}\" {StartupArgument}", RegistryValueKind.String);
			}
			else
			{
				key.DeleteValue(RunValueName, throwOnMissingValue: false);
			}
			return true;
		}
		catch (Exception)
		{
			return false;
		}
	}

	/// <summary>Opens the Settings page where a user re-enables a startup app they turned off.</summary>
	public static void OpenStartupSettings()
	{
		try
		{
			System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("ms-settings:startupapps") { UseShellExecute = true });
		}
		catch (Exception)
		{
		}
	}
}
