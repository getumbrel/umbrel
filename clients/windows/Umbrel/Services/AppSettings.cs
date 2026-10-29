using System.IO;
using System.Text.Json;
using Umbrel.Core;

namespace Umbrel.Services;

/// <summary>
/// Small non-secret app preferences, the counterpart of UserDefaults on macOS. Several
/// parts of the app write this file, so load it fresh right before each save.
/// </summary>
public sealed class AppSettings
{
	public bool LaunchAtLoginDefaultApplied { get; set; }
	public string? AutomaticallyPresentedUpdateVersion { get; set; }
	/// <summary>Package version of the last update found, so the tray menu still offers it after a relaunch.</summary>
	public string? AvailableUpdateVersion { get; set; }

	private static string FilePath => Path.Combine(Config.DefaultDirectory, "settings.json");

	public static AppSettings Load()
	{
		try
		{
			if (!File.Exists(FilePath)) return new AppSettings();
			return JsonSerializer.Deserialize<AppSettings>(File.ReadAllBytes(FilePath), Config.JsonOptions) ?? new AppSettings();
		}
		catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException)
		{
			return new AppSettings();
		}
	}

	public void Save()
	{
		try
		{
			Directory.CreateDirectory(Config.DefaultDirectory);
			File.WriteAllBytes(FilePath, JsonSerializer.SerializeToUtf8Bytes(this, Config.JsonOptions));
		}
		catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
		{
		}
	}
}
