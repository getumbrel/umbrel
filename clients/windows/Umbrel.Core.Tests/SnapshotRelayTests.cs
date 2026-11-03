using Umbrel.Core;
using Xunit;

namespace Umbrel.Core.Tests;

public class SnapshotRelayTests
{
	[Fact]
	public void OnlyTheNewestPendingValueIsDelivered()
	{
		var delivered = new List<string>();
		var relay = new SnapshotRelay<string>(delivered.Add);
		relay.Stage("old");
		relay.Stage("new");
		relay.Deliver();
		relay.Deliver();
		Assert.Equal(["new"], delivered);
	}

	// A watcher event on another thread stages a newer snapshot while the first one is
	// still being handled. It must arrive after the first, never before or instead of it.
	[Fact]
	public async Task ValuesStagedDuringADeliveryFollowItInOrder()
	{
		var delivered = new List<string>();
		var inFirst = new ManualResetEventSlim();
		var releaseFirst = new ManualResetEventSlim();
		var relay = new SnapshotRelay<string>(value =>
		{
			lock (delivered) delivered.Add(value);
			if (value != "first") return;
			inFirst.Set();
			releaseFirst.Wait(TimeSpan.FromSeconds(5));
		});
		var ct = TestContext.Current.CancellationToken;

		relay.Stage("first");
		var deliverer = Task.Run(relay.Deliver, ct);
		Assert.True(inFirst.Wait(TimeSpan.FromSeconds(5), ct));
		relay.Stage("second");
		relay.Stage("third");
		relay.Deliver(); // returns at once: the other thread is delivering
		lock (delivered) Assert.Equal(["first"], delivered);

		releaseFirst.Set();
		await deliverer;
		Assert.Equal(["first", "third"], delivered);
	}

	[Fact]
	public void AThrowingHandlerDoesNotStopLaterDeliveries()
	{
		var fail = true;
		var delivered = new List<string>();
		var relay = new SnapshotRelay<string>(value =>
		{
			if (fail) throw new InvalidOperationException();
			delivered.Add(value);
		});
		relay.Stage("a");
		Assert.Throws<InvalidOperationException>(relay.Deliver);
		fail = false;
		relay.Stage("b");
		relay.Deliver();
		Assert.Equal(["b"], delivered);
	}
}
