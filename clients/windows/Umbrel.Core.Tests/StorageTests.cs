using System.Runtime.InteropServices;
using Umbrel.Core;
using Xunit;

namespace Umbrel.Core.Tests;

public class StorageTests : IDisposable
{
	private readonly string _directory = Path.Combine(Path.GetTempPath(), "umbrelkit-tests-" + Guid.NewGuid().ToString("N"));

	public StorageTests() => Directory.CreateDirectory(_directory);

	public void Dispose() => Directory.Delete(_directory, recursive: true);

	[Fact]
	public void ConfigRoundTripsSavedDevices()
	{
		var path = Path.Combine(_directory, "config.json");
		var loaded = Config.Load(path);
		Assert.Null(loaded.Issue);
		loaded.Config.Save(new SavedDevice { Id = "b", Name = "B", Host = "b.local", Addresses = ["192.168.1.2"] });
		loaded.Config.Save(new SavedDevice { Id = "a", Name = "A", Host = "a.local", DashboardUsesHttps = true });
		loaded.Config.Update("a", device => device with { Name = "A2" });

		var reloaded = Config.Load(path);
		Assert.Equal(["a", "b"], reloaded.Config.SavedDevices.Keys.Order());
		Assert.Equal("A2", reloaded.Config.SavedDevices["a"].Name);
		Assert.True(reloaded.Config.SavedDevices["a"].DashboardUsesHttps);
		Assert.Equal(["192.168.1.2"], reloaded.Config.SavedDevices["b"].Addresses);
		Assert.Contains("\"savedDevices\"", File.ReadAllText(path));
	}

	[Fact]
	public void UpdateSkipsTheWriteWhenNothingChanged()
	{
		var path = Path.Combine(_directory, "config.json");
		var config = Config.Load(path).Config;
		config.Save(new SavedDevice { Id = "a", Name = "A", Host = "a.local", Addresses = ["192.168.1.2"] });
		File.Delete(path);

		config.Update("a", device => device.ReplaceAvailableAddresses(["192.168.1.2"]));
		Assert.False(File.Exists(path));

		config.Update("a", device => device.ReplaceAvailableAddresses(["192.168.1.3"]));
		Assert.Equal(["192.168.1.3"], Config.Load(path).Config.SavedDevices["a"].Addresses);
	}

	private static byte[] Json(string json) => System.Text.Encoding.UTF8.GetBytes(json);

	[Fact]
	public void UnreadableSessionsAreSignedOutNotStuckUnavailable()
	{
		Assert.IsType<SecretStore.SessionReadResult.Invalid>(
			SecretStore.ClassifySessionRead(new SecretStore.RawReadResult.Undecryptable()));
		Assert.IsType<SecretStore.SessionReadResult.Invalid>(
			SecretStore.ClassifySessionRead(new SecretStore.RawReadResult.Found(Json("""{"deviceId":"dev","accessToken":"a","accessExpiresAt":1,"deviceToken":"d"}"""))));
		Assert.IsType<SecretStore.SessionReadResult.Invalid>(
			SecretStore.ClassifySessionRead(new SecretStore.RawReadResult.Found(Json("""{"deviceId":"dev","accountId":"0","accessToken":"a","accessExpiresAt":1,"deviceToken":""}"""))));
		Assert.IsType<SecretStore.SessionReadResult.Unavailable>(
			SecretStore.ClassifySessionRead(new SecretStore.RawReadResult.Unavailable("IOException")));
		var found = Assert.IsType<SecretStore.SessionReadResult.Found>(SecretStore.ClassifySessionRead(
			new SecretStore.RawReadResult.Found(Json("""{"deviceId":"dev","accountId":"0","accessToken":"a","accessExpiresAt":1,"deviceToken":"d"}"""))));
		Assert.Equal(new Umbreld.Session("dev", "0", "a", 1, "d"), found.Value);
	}

	[Fact]
	public void UnreadablePinsStayUnavailableSoRecoveryCannotReplaceThem()
	{
		Assert.IsType<SecretStore.LocalHttpsCaReadResult.Unavailable>(
			SecretStore.ClassifyLocalHttpsCaRead(new SecretStore.RawReadResult.Undecryptable()));
		Assert.IsType<SecretStore.LocalHttpsCaReadResult.Missing>(
			SecretStore.ClassifyLocalHttpsCaRead(new SecretStore.RawReadResult.Missing()));
	}

	[Theory]
	[InlineData("{ not json")]
	[InlineData("""{"savedDevices":null}""")]
	[InlineData("""{"savedDevices":{"a":null}}""")]
	[InlineData("""{"savedDevices":{"a":{"id":"a","name":"A","host":"a.local","addresses":[null]}}}""")]
	[InlineData("""{"savedDevices":{"a":{"id":"a","name":"A","host":"a.local","accountProfiles":{"0":null}}}}""")]
	public void CorruptConfigIsQuarantinedNotOverwritten(string json)
	{
		var path = Path.Combine(_directory, "config.json");
		File.WriteAllText(path, json);
		var loaded = Config.Load(path);
		Assert.Equal(Config.StorageIssue.CorruptQuarantined, loaded.Issue);
		Assert.False(File.Exists(path));
		Assert.Single(Directory.GetFiles(_directory, "config.corrupt-*.json"));
	}

	[Fact]
	public void SecretStoreRoundTripsSessionsOnWindows()
	{
		if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows)) return; // DPAPI is Windows-only.
		SecretStore.Directory = Path.Combine(_directory, "secrets");
		var session = new Umbreld.Session("dev", "0", "access", 1, "device");
		Assert.True(SecretStore.SetSession(session, "dev"));
		Assert.Equal(session, Assert.IsType<SecretStore.SessionReadResult.Found>(SecretStore.ReadSession("dev")).Value);
		Assert.True(SecretStore.ReplaceSession(session with { AccessToken = "new" }, session));
		Assert.False(SecretStore.ReplaceSession(session, session with { DeviceToken = "other" }));
		SecretStore.DeleteSession("dev");
		Assert.IsType<SecretStore.SessionReadResult.Missing>(SecretStore.ReadSession("dev"));

		var ca = new byte[] { 1, 2, 3 };
		Assert.Equal(SecretStore.LocalHttpsCaStoreResult.Stored, SecretStore.StoreLocalHttpsCaIfAbsent(ca, "dev"));
		Assert.Equal(SecretStore.LocalHttpsCaStoreResult.AlreadyMatches, SecretStore.StoreLocalHttpsCaIfAbsent(ca, "dev"));
		Assert.Equal(SecretStore.LocalHttpsCaStoreResult.Conflicts, SecretStore.StoreLocalHttpsCaIfAbsent([9], "dev"));
		Assert.Equal(SecretStore.LocalHttpsCaStoreResult.Stored, SecretStore.ReplaceLocalHttpsCa([9], "dev"));
	}
}
