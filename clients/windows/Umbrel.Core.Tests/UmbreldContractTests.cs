using System.Text;
using System.Text.Json;
using Umbrel.Core;
using Xunit;

namespace Umbrel.Core.Tests;

public class UmbreldContractTests
{
	private static HttpResult Result(int status, string json) => new(status, Encoding.UTF8.GetBytes(json), "application/json");

	[Fact]
	public void SuccessEnvelopeDecodesData()
	{
		var info = Umbreld.DecodeEnvelope<Umbreld.DiscoveryInfo>(
			Result(200, """{"result":{"data":{"id":"abc","device":"Umbrel Home","onboarded":true}}}"""),
			"system.discoveryInfo");
		Assert.Equal("abc", info.Id);
		Assert.Equal("Umbrel Home", info.Device);
		Assert.True(info.Onboarded);
	}

	[Fact]
	public void ErrorEnvelopeSurfacesTheServerMessage()
	{
		var error = Assert.Throws<UmbreldException>(() =>
			Umbreld.DecodeEnvelope<bool>(Result(401, """{"error":{"message":"Missing 2FA code"}}"""), "user.loginNative"));
		Assert.Equal(401, error.Status);
		Assert.True(error.IsAuthError);
		Assert.True(error.RequiresTwoFactorAuthentication);
	}

	[Fact]
	public void MissingDataIsAProtocolFailure()
	{
		Assert.Throws<UmbreldException>(() => Umbreld.DecodeEnvelope<bool>(Result(200, """{"result":{}}"""), "x"));
		Assert.Throws<UmbreldException>(() => Umbreld.DecodeEnvelope<bool>(Result(200, "not json"), "x"));
	}

	[Fact]
	public void NullResultsAreProtocolFailures()
	{
		// A null share password must not reach the SMB mount, where WNet would use the
		// signed-in Windows account's credential instead.
		Assert.Throws<UmbreldException>(() =>
			Umbreld.DecodeEnvelope<string>(Result(200, """{"result":{"data":null}}"""), "files.sharePassword"));
		Assert.Throws<UmbreldException>(() =>
			Umbreld.DecodeEnvelope<Umbreld.UserInfo>(Result(200, """{"result":{"data":null}}"""), "user.get"));
	}

	private static HttpResult UserResult(string sambaField) => Result(200,
		"""{"result":{"data":{"userId":"0","name":"Patrick","role":"owner","homePath":"/Home","sambaEnabled":true,"wallpaper":{"id":"18","brandColorHsl":"259 100% 59%"}"""
		+ sambaField + "}}}");

	[Fact]
	public void RequiredFieldsMustBePresentAndNonNull()
	{
		Assert.Equal("umbrel", Umbreld.DecodeEnvelope<Umbreld.UserInfo>(UserResult(",\"sambaUsername\":\"umbrel\""), "user.get").SambaUsername);
		// A null Samba username would make Windows mount the share with the PC user's own credentials.
		Assert.Throws<UmbreldException>(() =>
			Umbreld.DecodeEnvelope<Umbreld.UserInfo>(UserResult(",\"sambaUsername\":null"), "user.get"));
		Assert.Throws<UmbreldException>(() => Umbreld.DecodeEnvelope<Umbreld.UserInfo>(UserResult(""), "user.get"));
		Assert.Throws<UmbreldException>(() => Umbreld.DecodeEnvelope<Umbreld.DiscoveryInfo>(
			Result(200, """{"result":{"data":{"id":"abc","device":"Umbrel Home"}}}"""), "system.discoveryInfo"));
		Assert.Throws<UmbreldException>(() => Umbreld.DecodeEnvelope<IReadOnlyList<Umbreld.Share>>(
			Result(200, """{"result":{"data":[{"name":"Home","sharename":"Home"}]}}"""), "files.shares"));
	}

	[Fact]
	public void ListsRejectNullElements()
	{
		Assert.Throws<UmbreldException>(() => Umbreld.DecodeEnvelope<IReadOnlyList<string>>(
			Result(200, """{"result":{"data":["192.168.1.10",null]}}"""), "system.getIpAddresses"));
		Assert.Throws<UmbreldException>(() => Umbreld.DecodeEnvelope<IReadOnlyList<Umbreld.Share>>(
			Result(200, """{"result":{"data":[null]}}"""), "files.shares"));
		Assert.Equal(["192.168.1.10"], Umbreld.DecodeEnvelope<IReadOnlyList<string>>(
			Result(200, """{"result":{"data":["192.168.1.10"]}}"""), "system.getIpAddresses"));
	}

	[Fact]
	public void OptionalFieldsMayBeOmittedOrNull()
	{
		var accounts = Umbreld.DecodeEnvelope<IReadOnlyList<Umbreld.Account>>(
			Result(200, """{"result":{"data":[{"userId":"0","name":"A","wallpaper":{"id":"1","brandColorHsl":"x"},"avatarUrl":null},{"userId":"1","name":"B","wallpaper":{"id":"2","brandColorHsl":"y"}}]}}"""),
			"user.listAccounts");
		Assert.All(accounts, account => Assert.Null(account.AvatarUrl));
	}

	[Fact]
	public void SessionSerializesAndTracksTheSameLogin()
	{
		var session = new Umbreld.Session("dev", "0", "access", 123, "device");
		var json = JsonSerializer.Serialize(session, Umbreld.JsonOptions);
		using var document = JsonDocument.Parse(json);
		Assert.Equal("access", document.RootElement.GetProperty("accessToken").GetString());
		Assert.Equal(123, document.RootElement.GetProperty("accessExpiresAt").GetInt64());
		Assert.True(session.BelongsToSameLogin(session with { AccessToken = "rotated", AccessExpiresAt = 999 }));
		Assert.False(session.BelongsToSameLogin(session with { DeviceToken = "other" }));
	}

	[Fact]
	public void FallbackVersionRequiresAnUmbrelOsName()
	{
		Umbreld.ValidateFallbackSystemVersion(Result(200, """{"result":{"data":{"version":"1.4.0","name":"umbrelOS 1.4.0"}}}"""));
		Assert.Throws<UmbreldException>(() =>
			Umbreld.ValidateFallbackSystemVersion(Result(200, """{"result":{"data":{"version":"1.0","name":"otherOS"}}}""")));
	}

	[Theory]
	[InlineData("/api/accounts/0/avatar/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.webp", true)]
	[InlineData("/api/accounts/member-1/avatar/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.webp", true)]
	[InlineData("https://evil/api/accounts/0/avatar/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.webp", false)]
	[InlineData("/api/accounts/0/avatar/../x.webp", false)]
	[InlineData("/api/accounts/0/avatar/0123456789ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef.webp", false)]
	[InlineData("/api/accounts/--/avatar/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.webp", false)]
	public void AvatarPathsAreStrictlyValidated(string path, bool expected) =>
		Assert.Equal(expected, Umbreld.IsValidAccountAvatarPath(path));

	[Fact]
	public void PemCertificatesDecodeToDer()
	{
		Assert.Throws<LocalHttpsTransportException>(() => LocalHttpsTransport.CertificateDataFromPem("not a certificate"));
		Assert.Throws<LocalHttpsTransportException>(() =>
			LocalHttpsTransport.CertificateDataFromPem("-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----"));
	}
}
