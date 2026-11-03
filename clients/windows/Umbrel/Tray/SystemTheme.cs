using Microsoft.Win32;

namespace Umbrel.Tray;

/// <summary>
/// Chooses the tray glyph colour from the Windows colour mode, the one the taskbar follows.
/// The app colour mode, the one UISettings colours derive from, differs from it when
/// Personalization is set to Custom. No API exposes the Windows colour mode to desktop
/// apps, so it is read from the SystemUsesLightTheme value Settings writes, and a missing
/// value reads as dark: the taskbar is dark unless the Windows mode is set to Light.
/// </summary>
internal static class SystemTheme
{
	private const string PersonalizeKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";

	/// <summary>True unless the Windows colour mode is Light, so also when it can't be read.</summary>
	public static bool IsDarkMode()
	{
		try
		{
			using var key = Registry.CurrentUser.OpenSubKey(PersonalizeKeyPath, writable: false);
			return key?.GetValue("SystemUsesLightTheme") is not int light || light == 0;
		}
		catch (Exception)
		{
			return true;
		}
	}
}
