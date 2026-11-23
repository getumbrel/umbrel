using System.Xml;
using System.Xml.Linq;

namespace Umbrel.Core;

/// <summary>
/// The version an App Installer file offers the installed app. The file isn't signed, and
/// Windows would do whatever it says, such as install a different package or go back to
/// an older version (ForceUpdateFromAnyVersion). So the app reads only the version and
/// package address from it and never hands the file itself to Windows.
/// </summary>
public sealed record UpdateFeed(Version Version, Uri PackageUri)
{
	/// <summary>
	/// Null unless the file offers this package (same name and publisher) a four-part
	/// version at an HTTPS address. Whether that version is an update is the caller's
	/// to decide.
	/// </summary>
	public static UpdateFeed? Parse(string xml, string name, string publisher)
	{
		XElement? main;
		try
		{
			main = XDocument.Parse(xml).Root?.Elements().FirstOrDefault(element => element.Name.LocalName == "MainPackage");
		}
		catch (XmlException)
		{
			return null;
		}
		if (main is null) return null;
		if (main.Attribute("Name")?.Value != name || main.Attribute("Publisher")?.Value != publisher) return null;
		// Package versions have four parts.
		if (!Version.TryParse(main.Attribute("Version")?.Value, out var version) || version.Revision < 0) return null;
		if (!Uri.TryCreate(main.Attribute("Uri")?.Value, UriKind.Absolute, out var packageUri) || packageUri.Scheme != Uri.UriSchemeHttps) return null;
		return new UpdateFeed(version, packageUri);
	}
}
