using Umbrel.Core;
using Xunit;

namespace Umbrel.Core.Tests;

public class UpdateFeedTests
{
	private const string Name = "Umbrel.Umbrel";
	private const string Publisher = "CN=\"Umbrel, Inc.\", O=\"Umbrel, Inc.\", L=Claymont, S=Delaware, C=US";
	private const string PackageUri = "https://download.umbrel.com/windows/Umbrel-0.1.4.5-x64.msix";

	private static string Feed(
		string name = Name,
		string publisher = Publisher,
		string version = "0.1.4.5",
		string packageUri = PackageUri,
		string element = "MainPackage",
		string extra = "") =>
		$"""
		<?xml version="1.0" encoding="utf-8"?>
		<AppInstaller xmlns="http://schemas.microsoft.com/appx/appinstaller/2018" Version="{version}" Uri="https://download.umbrel.com/windows/Umbrel.appinstaller">
		  <{element} Name="{name}" Publisher="{System.Security.SecurityElement.Escape(publisher)}" Version="{version}" ProcessorArchitecture="x64" Uri="{packageUri}" />
		  {extra}
		</AppInstaller>
		""";

	private static UpdateFeed? Parse(string xml) => UpdateFeed.Parse(xml, Name, Publisher);

	[Fact]
	public void ThisPackagesVersionAndAddressAreRead()
	{
		// What else the file says, such as the override that allows older versions, is never read.
		var feed = Parse(Feed(extra: "<UpdateSettings><ForceUpdateFromAnyVersion>true</ForceUpdateFromAnyVersion></UpdateSettings>"));

		Assert.Equal(new UpdateFeed(new Version(0, 1, 4, 5), new Uri(PackageUri)), feed);
	}

	// The caller compares the version with the installed one.
	[Theory]
	[InlineData("0.1.3.4")]
	[InlineData("0.1.0.1")]
	public void TheSameOrALowerVersionIsStillRead(string version) =>
		Assert.Equal(Version.Parse(version), Parse(Feed(version: version))?.Version);

	[Theory]
	[InlineData("0.1.4")]
	[InlineData("")]
	[InlineData("newest")]
	public void OnlyAFourPartVersionIsAccepted(string version) =>
		Assert.Null(Parse(Feed(version: version)));

	[Fact]
	public void AnotherPackageIsRefused()
	{
		Assert.Null(Parse(Feed(name: "Microsoft.Winget.Source")));
		Assert.Null(Parse(Feed(publisher: "CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US")));
		Assert.Null(Parse(Feed(element: "MainBundle")));
	}

	[Theory]
	[InlineData("http://download.umbrel.com/windows/Umbrel-0.1.4.5-x64.msix")]
	[InlineData("file:///C:/Users/Public/Umbrel-0.1.4.5-x64.msix")]
	[InlineData(@"\\example.com\share\Umbrel-0.1.4.5-x64.msix")]
	[InlineData("Umbrel-0.1.4.5-x64.msix")]
	[InlineData("")]
	public void ThePackageAddressMustBeHttps(string packageUri) =>
		Assert.Null(Parse(Feed(packageUri: packageUri)));

	[Theory]
	[InlineData("")]
	[InlineData("not xml")]
	[InlineData("<html><body>Not found</body></html>")]
	[InlineData("<AppInstaller />")]
	public void AFileWithoutAMainPackageIsRefused(string xml) =>
		Assert.Null(Parse(xml));
}
