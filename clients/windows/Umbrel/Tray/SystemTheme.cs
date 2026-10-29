using Windows.UI.ViewManagement;

namespace Umbrel.Tray;

/// <summary>
/// Chooses the tray glyph colour from the app colour mode, the one UISettings exposes.
/// The taskbar follows the Windows colour mode, which differs only when Personalization
/// is set to Custom. GetColorValue is supported in desktop apps; ColorValuesChanged is
/// not, so callers re-read this whenever the icon is refreshed instead of subscribing.
/// </summary>
internal static class SystemTheme
{
	public static bool IsDarkMode()
	{
		try
		{
			var background = new UISettings().GetColorValue(UIColorType.Background);
			// Perceived brightness: a dark app background means light glyphs.
			var luminance = (0.299 * background.R + 0.587 * background.G + 0.114 * background.B) / 255.0;
			return luminance < 0.5;
		}
		catch (Exception)
		{
			return true;
		}
	}
}
