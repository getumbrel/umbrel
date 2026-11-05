using Umbrel.Core;
using Xunit;

namespace Umbrel.Core.Tests;

/// <summary>
/// Drives the coordinator against an in-memory store and a fake refreshNativeAccess that
/// behaves like umbreld: the device token never rotates, and each refresh revokes every
/// access token issued before it.
/// </summary>
public class SessionCoordinatorTests
{
	private readonly object _gate = new();
	private Umbreld.Session? _stored;
	private int _refreshes;
	private Func<string, SecretStore.SessionReadResult>? _readHook;

	private static long Now => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

	// Inside the 60 s refresh leeway, so every caller wants a refresh.
	private static Umbreld.Session Expiring(string access = "acc-0") => new("dev", "0", access, Now + 10_000, "device");

	private SecretStore.SessionReadResult Read(string deviceId)
	{
		lock (_gate) return _stored is null ? new SecretStore.SessionReadResult.Missing() : new SecretStore.SessionReadResult.Found(_stored);
	}

	private Umbreld.SessionCoordinator Coordinator(Func<Umbreld.Session, Task<Umbreld.Session>>? refresh = null) => new(
		deviceId => (_readHook ?? Read)(deviceId),
		(session, expected) =>
		{
			lock (_gate)
			{
				if (_stored is null || !_stored.BelongsToSameLogin(expected)) return false;
				_stored = session;
				return true;
			}
		},
		expected =>
		{
			lock (_gate)
			{
				if (_stored is not null && _stored.BelongsToSameLogin(expected)) _stored = null;
			}
		},
		(_, session) => refresh?.Invoke(session) ?? Refresh(session));

	private async Task<Umbreld.Session> Refresh(Umbreld.Session session)
	{
		await Task.Yield();
		var count = Interlocked.Increment(ref _refreshes);
		return session with { AccessToken = $"acc-{count}", AccessExpiresAt = Now + 3_600_000 };
	}

	[Fact]
	public async Task ConcurrentCallersShareOneRefresh()
	{
		_stored = Expiring();
		var coordinator = Coordinator();
		var ct = TestContext.Current.CancellationToken;
		var results = await Task.WhenAll(Enumerable.Range(0, 8)
			.Select(_ => Task.Run(() => coordinator.SessionAsync("h", Expiring(), ct), ct)));
		Assert.All(results, session => Assert.Equal("acc-1", session.AccessToken));
		Assert.Equal(1, _refreshes);
		Assert.Equal("acc-1", _stored!.AccessToken);
	}

	// A caller that read the stored session just before another caller's refresh stored
	// its token and finished must not start a second refresh: that would revoke acc-1,
	// which the first refresh already handed out.
	[Fact]
	public async Task AStaleReadNeverStartsASecondRefresh()
	{
		_stored = Expiring();
		var coordinator = Coordinator();
		var ct = TestContext.Current.CancellationToken;
		var firstReadStarted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
		var otherCallerFinished = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
		var paused = 0;
		_readHook = deviceId =>
		{
			var read = Read(deviceId);
			if (Interlocked.Exchange(ref paused, 1) == 0)
			{
				// Hold this caller's read while the other caller runs as far as it can.
				firstReadStarted.SetResult();
				SpinWait.SpinUntil(() => otherCallerFinished.Task.IsCompleted, TimeSpan.FromMilliseconds(500));
			}
			return read;
		};

		var stale = Task.Run(() => coordinator.SessionAsync("h", Expiring(), ct), ct);
		await firstReadStarted.Task.WaitAsync(ct);
		var other = Task.Run(() => coordinator.SessionAsync("h", Expiring(), ct), ct);
		_ = other.ContinueWith(_ => otherCallerFinished.TrySetResult(), ct, TaskContinuationOptions.None, TaskScheduler.Default);

		var results = await Task.WhenAll(stale, other);
		Assert.All(results, session => Assert.Equal("acc-1", session.AccessToken));
		Assert.Equal(1, _refreshes);
	}

	[Fact]
	public async Task ARejectedTokenThatWasAlreadyReplacedIsNotRefreshedAgain()
	{
		_stored = Expiring("acc-5") with { AccessExpiresAt = Now + 3_600_000 };
		var session = await Coordinator().SessionAsync(
			"h", Expiring(), TestContext.Current.CancellationToken, forceRefresh: true, rejectedAccessToken: "acc-0");
		Assert.Equal("acc-5", session.AccessToken);
		Assert.Equal(0, _refreshes);
	}

	[Fact]
	public async Task ARevokedLoginIsDeletedAndReportedAsSignedOut()
	{
		_stored = Expiring();
		var coordinator = Coordinator(_ => throw new UmbreldException(401, "Invalid native session"));
		var error = await Assert.ThrowsAsync<UmbreldException>(() =>
			coordinator.SessionAsync("h", Expiring(), TestContext.Current.CancellationToken));
		Assert.True(error.IsAuthError);
		Assert.Null(_stored);
	}

	[Fact]
	public async Task AnotherLoginIsNeverRefreshedOrReplaced()
	{
		_stored = Expiring() with { AccountId = "member-1", DeviceToken = "other" };
		var error = await Assert.ThrowsAsync<UmbreldException>(() =>
			Coordinator().SessionAsync("h", Expiring(), TestContext.Current.CancellationToken));
		Assert.True(error.IsAuthError);
		Assert.Equal(0, _refreshes);
		Assert.Equal("member-1", _stored!.AccountId);
	}
}
