using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Umbrel.Core;

/// <summary>
/// Native device grants and local HTTPS trust anchors, one protected file per Umbrel
/// id, in the non-roaming LocalAppData folder. This is the Windows counterpart of the
/// Apple Keychain store: every blob is sealed with DPAPI (<see cref="ProtectedData"/>,
/// current-user scope), which keeps it from other Windows users but not from other
/// programs running as this user. Windows has no equivalent of the Keychain access
/// group that limits the Mac items to Umbrel. The stable device credential never lives
/// in config files.
/// </summary>
[SupportedOSPlatform("windows")]
public static class SecretStore
{
	private const string SessionService = "com.umbrel.windows.session";
	private const string LocalHttpsCaService = "com.umbrel.windows.local-https-ca";

	private static readonly object SessionMutationLock = new();
	private static readonly object LocalHttpsCaMutationLock = new();
	private static readonly object CacheLock = new();
	private static readonly Dictionary<string, Umbreld.Session> SessionCache = new();
	private static string _directory = Path.Combine(Config.DefaultDirectory, "secrets");

	/// <summary>Tests point this at a temporary directory; apps keep the default.</summary>
	public static string Directory
	{
		get => _directory;
		set => _directory = value;
	}

	public abstract record SessionReadResult
	{
		public sealed record Found(Umbreld.Session Value) : SessionReadResult;
		public sealed record Missing : SessionReadResult;
		public sealed record Invalid : SessionReadResult;
		public sealed record Unavailable(string Reason, Umbreld.Session? CachedSession) : SessionReadResult;

		public Umbreld.Session? Session => this switch
		{
			Found found => found.Value,
			Unavailable unavailable => unavailable.CachedSession,
			_ => null,
		};
	}

	public abstract record LocalHttpsCaReadResult
	{
		public sealed record Found(byte[] Certificate) : LocalHttpsCaReadResult;
		public sealed record Missing : LocalHttpsCaReadResult;
		public sealed record Unavailable(string Reason) : LocalHttpsCaReadResult;
	}

	public enum LocalHttpsCaStoreResult
	{
		Stored,
		AlreadyMatches,
		Conflicts,
		Unavailable,
	}

	internal abstract record RawReadResult
	{
		public sealed record Found(byte[] Data) : RawReadResult;
		public sealed record Missing : RawReadResult;
		// The blob exists but DPAPI can't open it, usually for good: it was sealed on
		// another PC, or under a user key lost to an administrator password reset.
		public sealed record Undecryptable : RawReadResult;
		public sealed record Unavailable(string Reason) : RawReadResult;
	}

	// ── Sessions ──

	/// <summary>Returns false when the session could not be stored; callers must not
	/// continue with credentials that won't survive a relaunch.</summary>
	public static bool SetSession(Umbreld.Session session, string deviceId)
	{
		lock (SessionMutationLock) return SetSessionUnlocked(session, deviceId);
	}

	private static bool SetSessionUnlocked(Umbreld.Session session, string deviceId)
	{
		byte[] data;
		try
		{
			data = JsonSerializer.SerializeToUtf8Bytes(session, Umbreld.JsonOptions);
		}
		catch (JsonException)
		{
			return false;
		}
		var stored = Write(SessionService, deviceId, data);
		if (stored)
		{
			lock (CacheLock) SessionCache[deviceId] = session;
		}
		return stored;
	}

	/// <summary>Item absence and malformed stored credentials are definitive. Other
	/// storage failures are transient, not proof of logout.</summary>
	public static SessionReadResult ReadSession(string deviceId)
	{
		lock (SessionMutationLock) return ReadSessionUnlocked(deviceId);
	}

	private static SessionReadResult ReadSessionUnlocked(string deviceId)
	{
		var read = ClassifySessionRead(Read(SessionService, deviceId));
		switch (read)
		{
			case SessionReadResult.Found found:
				lock (CacheLock) SessionCache[deviceId] = found.Value;
				return read;
			case SessionReadResult.Unavailable unavailable:
				Umbreld.Session? cached;
				lock (CacheLock) SessionCache.TryGetValue(deviceId, out cached);
				return unavailable with { CachedSession = cached };
			default:
				lock (CacheLock) SessionCache.Remove(deviceId);
				return read;
		}
	}

	/// <summary>
	/// Like the Apple Keychain store, a session that exists but can't be read is Invalid,
	/// not Unavailable, so the app shows the account as signed out instead of waiting on
	/// storage that won't recover. Only I/O failures are Unavailable.
	/// </summary>
	internal static SessionReadResult ClassifySessionRead(RawReadResult read)
	{
		switch (read)
		{
			case RawReadResult.Found found:
				Umbreld.Session? session = null;
				try
				{
					session = JsonSerializer.Deserialize<Umbreld.Session>(found.Data, Umbreld.JsonOptions);
				}
				catch (JsonException)
				{
				}
				return session is null || session.DeviceToken.Length == 0
					? new SessionReadResult.Invalid()
					: new SessionReadResult.Found(session);
			case RawReadResult.Missing:
				return new SessionReadResult.Missing();
			case RawReadResult.Undecryptable:
				return new SessionReadResult.Invalid();
			case RawReadResult.Unavailable unavailable:
				return new SessionReadResult.Unavailable(unavailable.Reason, null);
			default:
				throw new InvalidOperationException();
		}
	}

	public static void DeleteSession(string deviceId)
	{
		lock (SessionMutationLock) DeleteSessionUnlocked(deviceId);
	}

	private static void DeleteSessionUnlocked(string deviceId)
	{
		lock (CacheLock) SessionCache.Remove(deviceId);
		Delete(SessionService, deviceId);
	}

	/// <summary>Refresh runs concurrently with UI-driven sign-in and sign-out. Only the
	/// same server-issued login may be replaced.</summary>
	internal static bool ReplaceSession(Umbreld.Session session, Umbreld.Session expected)
	{
		lock (SessionMutationLock)
		{
			var stored = ReadSessionUnlocked(expected.DeviceId).Session;
			if (stored is null || !stored.BelongsToSameLogin(expected)) return false;
			return SetSessionUnlocked(session, expected.DeviceId);
		}
	}

	internal static void DeleteSession(Umbreld.Session expected)
	{
		lock (SessionMutationLock)
		{
			var stored = ReadSessionUnlocked(expected.DeviceId).Session;
			if (stored is null || !stored.BelongsToSameLogin(expected)) return;
			DeleteSessionUnlocked(expected.DeviceId);
		}
	}

	// ── Local HTTPS CA ──
	// The enrolled CA is public, but its integrity is security-sensitive. Enrollment is
	// write-once: replacing a CA requires explicitly forgetting the Umbrel, so concurrent
	// discovery can never silently change an existing pin.

	internal static LocalHttpsCaStoreResult StoreLocalHttpsCaIfAbsent(byte[] certificate, string deviceId)
	{
		lock (LocalHttpsCaMutationLock)
		{
			switch (ReadLocalHttpsCaUnlocked(deviceId))
			{
				case LocalHttpsCaReadResult.Found found:
					return found.Certificate.AsSpan().SequenceEqual(certificate)
						? LocalHttpsCaStoreResult.AlreadyMatches
						: LocalHttpsCaStoreResult.Conflicts;
				case LocalHttpsCaReadResult.Unavailable:
					return LocalHttpsCaStoreResult.Unavailable;
				default:
					return Write(LocalHttpsCaService, deviceId, certificate)
						? LocalHttpsCaStoreResult.Stored
						: LocalHttpsCaStoreResult.Unavailable;
			}
		}
	}

	/// <summary>Claiming an unsaved discovery result is an explicit first-use trust action.
	/// Callers must never use this for a device that is already saved.</summary>
	internal static LocalHttpsCaStoreResult ReplaceLocalHttpsCa(byte[] certificate, string deviceId)
	{
		lock (LocalHttpsCaMutationLock)
		{
			switch (ReadLocalHttpsCaUnlocked(deviceId))
			{
				case LocalHttpsCaReadResult.Found found when found.Certificate.AsSpan().SequenceEqual(certificate):
					return LocalHttpsCaStoreResult.AlreadyMatches;
				case LocalHttpsCaReadResult.Unavailable:
					return LocalHttpsCaStoreResult.Unavailable;
				default:
					return Write(LocalHttpsCaService, deviceId, certificate)
						? LocalHttpsCaStoreResult.Stored
						: LocalHttpsCaStoreResult.Unavailable;
			}
		}
	}

	public static LocalHttpsCaReadResult ReadLocalHttpsCa(string deviceId)
	{
		lock (LocalHttpsCaMutationLock) return ReadLocalHttpsCaUnlocked(deviceId);
	}

	private static LocalHttpsCaReadResult ReadLocalHttpsCaUnlocked(string deviceId) =>
		ClassifyLocalHttpsCaRead(Read(LocalHttpsCaService, deviceId));

	/// <summary>
	/// Unlike a session, an unreadable pin is never reported as absent: DPAPI can't tell a
	/// blob from another PC apart from a key that is only briefly unavailable, and absence
	/// would let sign-in recovery replace the pin by first use. Like the Apple Keychain
	/// store's undecodable CA, it stays Unavailable; removing the Umbrel deletes it.
	/// </summary>
	internal static LocalHttpsCaReadResult ClassifyLocalHttpsCaRead(RawReadResult read) =>
		read switch
		{
			RawReadResult.Found found => new LocalHttpsCaReadResult.Found(found.Data),
			RawReadResult.Missing => new LocalHttpsCaReadResult.Missing(),
			RawReadResult.Undecryptable => new LocalHttpsCaReadResult.Unavailable("undecryptable"),
			RawReadResult.Unavailable unavailable => new LocalHttpsCaReadResult.Unavailable(unavailable.Reason),
			_ => throw new InvalidOperationException(),
		};

	internal static void DeleteLocalHttpsCa(string deviceId)
	{
		lock (LocalHttpsCaMutationLock) Delete(LocalHttpsCaService, deviceId);
	}

	// ── Protected file plumbing ──

	private static string FilePath(string service, string account)
	{
		// Hash the logical key so untrusted ids can never influence the on-disk path.
		var digest = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"{service}\0{account}")));
		return Path.Combine(_directory, $"{digest.ToLowerInvariant()}.bin");
	}

	// Extra entropy binds each blob to its logical key, so a file moved into another
	// Umbrel's slot fails to decrypt instead of being read as that Umbrel's.
	private static byte[] Entropy(string service, string account) =>
		Encoding.UTF8.GetBytes($"com.umbrel.windows\0{service}\0{account}");

	private static bool Write(string service, string account, byte[] plaintext)
	{
		try
		{
			System.IO.Directory.CreateDirectory(_directory);
			var sealedData = ProtectedData.Protect(plaintext, Entropy(service, account), DataProtectionScope.CurrentUser);
			var path = FilePath(service, account);
			var tempPath = Path.Combine(_directory, $".{Guid.NewGuid():N}.tmp");
			File.WriteAllBytes(tempPath, sealedData);
			File.Move(tempPath, path, overwrite: true);
			return true;
		}
		catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or CryptographicException)
		{
			return false;
		}
	}

	private static RawReadResult Read(string service, string account)
	{
		var path = FilePath(service, account);
		byte[] sealedData;
		try
		{
			sealedData = File.ReadAllBytes(path);
		}
		// Only a missing file is Missing. File.Exists also says false when access is
		// denied, which would let an unreadable CA pin look absent.
		catch (Exception ex) when (ex is FileNotFoundException or DirectoryNotFoundException)
		{
			return new RawReadResult.Missing();
		}
		catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
		{
			return new RawReadResult.Unavailable(ex.GetType().Name);
		}
		try
		{
			return new RawReadResult.Found(
				ProtectedData.Unprotect(sealedData, Entropy(service, account), DataProtectionScope.CurrentUser));
		}
		catch (CryptographicException)
		{
			// A blob sealed by another user or machine is unreadable here by design.
			return new RawReadResult.Undecryptable();
		}
	}

	private static void Delete(string service, string account)
	{
		try
		{
			File.Delete(FilePath(service, account));
		}
		catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
		{
		}
	}
}
