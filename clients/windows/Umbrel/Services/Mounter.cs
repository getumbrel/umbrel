using Umbrel.Interop;

namespace Umbrel.Services;

public sealed class MountException(string message, uint code = 0) : Exception(message)
{
	public uint Code { get; } = code;
}

/// <summary>
/// Maps an Umbrel's SMB shares to drive letters with WNetUseConnection, the Win32
/// counterpart of NetFSMountURLSync. The OS picks the drive letter (CONNECT_REDIRECT,
/// Z: downward) and returns it, so the app never guesses a local name. Connections
/// are session-scoped rather than profile-persistent: like the macOS Finder mounts they
/// outlive the app but not a logoff.
///
/// This type only reads and changes drive mappings. AppState decides which mappings
/// belong to an Umbrel and adopts or disconnects one only after its host proves the
/// pinned device identity. Credentials are passed to the API call and never persisted
/// by the app.
/// </summary>
public static class Mounter
{
	public sealed record MountedShare(string Host, string Sharename, string Path);

	// Windows reserves these in names, and the sharename becomes one UNC path component.
	private const string ReservedNameCharacters = "<>:\"/\\|?*";

	/// <summary>Map the share and return the assigned drive root, for example "Z:\".</summary>
	public static Task<string> MountAsync(
		string host,
		string sharename,
		string username,
		string password,
		bool forceNewSession,
		CancellationToken ct) =>
		Task.Run(() =>
		{
			Validate(sharename);
			// WNet treats a missing user name or password as "use the signed-in Windows
			// account", which would hand that account's credential to the Umbrel. A leading
			// NUL reaches WNet as an empty string, so any NUL counts as missing.
			if (string.IsNullOrEmpty(username) || string.IsNullOrEmpty(password)
				|| username.Contains('\0') || password.Contains('\0'))
			{
				throw new MountException("This Umbrel didn’t provide a username and password for file sharing");
			}
			var remote = RemoteName(host, sharename);
			if (remote.Length > NativeMethods.MAX_PATH)
			{
				throw new MountException($"The shared folder name {sharename} is too long for Windows");
			}
			if (forceNewSession) CancelServerConnections(host);
			var result = Connect(remote, username, password);
			if (result.Code == NativeMethods.ERROR_SESSION_CREDENTIAL_CONFLICT)
			{
				// Windows allows one credential per server per logon session. Drop deviceless
				// connections that may hold a previous credential, then retry once. Lettered
				// drives aren't touched here: AppState unmounts them before a credential change.
				CancelServerConnections(host);
				result = Connect(remote, username, password);
			}
			if (result.Code != NativeMethods.ERROR_SUCCESS) throw new MountException(Describe(result.Code, remote), result.Code);
			ct.ThrowIfCancellationRequested();
			return result.LocalName ?? throw new MountException($"Windows didn’t report a drive letter for {remote}");
		}, ct);

	private static (uint Code, string? LocalName) Connect(string remote, string username, string password)
	{
		var provider = LanmanProviderName();
		var buffer = new char[NativeMethods.MAX_PATH];
		var code = ConnectInto(remote, provider, username, password, buffer, out var size);
		if (code == NativeMethods.ERROR_MORE_DATA)
		{
			// No connection is made when the buffer is too small, so retrying is safe.
			buffer = new char[size];
			code = ConnectInto(remote, provider, username, password, buffer, out _);
		}
		if (code != NativeMethods.ERROR_SUCCESS) return (code, null);
		var local = NativeMethods.StringFromBuffer(buffer).TrimEnd('\\');
		return (code, local.Length == 0 ? null : local + "\\");
	}

	private static unsafe uint ConnectInto(
		string remote,
		string provider,
		string username,
		string password,
		char[] accessName,
		out uint size)
	{
		size = (uint)accessName.Length;
		fixed (char* remotePointer = remote)
		fixed (char* providerPointer = provider)
		{
			var resource = new NativeMethods.NETRESOURCEW
			{
				dwType = NativeMethods.RESOURCETYPE_DISK,
				lpLocalName = null,
				lpRemoteName = remotePointer,
				lpProvider = providerPointer,
			};
			return NativeMethods.WNetUseConnectionW(
				IntPtr.Zero,
				ref resource,
				password,
				username,
				NativeMethods.CONNECT_REDIRECT | NativeMethods.CONNECT_TEMPORARY,
				accessName,
				ref size,
				out _);
		}
	}

	// Naming the Windows SMB client's provider means only it receives the share login.
	// An empty name (lookup failed) lets Windows pick the provider by parsing the path.
	private static string LanmanProviderName()
	{
		var buffer = new char[NativeMethods.MAX_PATH];
		var size = (uint)buffer.Length;
		var code = NativeMethods.WNetGetProviderNameW(NativeMethods.WNNC_NET_LANMAN, buffer, ref size);
		if (code == NativeMethods.ERROR_MORE_DATA)
		{
			buffer = new char[size];
			code = NativeMethods.WNetGetProviderNameW(NativeMethods.WNNC_NET_LANMAN, buffer, ref size);
		}
		return code == NativeMethods.ERROR_SUCCESS ? NativeMethods.StringFromBuffer(buffer) : "";
	}

	/// <summary>
	/// Disconnect on the thread pool: from an unreachable host this can take about a minute.
	/// Unless forced, it fails on open files (see HasOpenFiles). Flags 0 leaves the user's
	/// profile alone: the app's own drives are temporary, and a drive the user saved to
	/// reconnect at sign-in keeps doing so.
	/// </summary>
	public static Task UnmountAsync(string path, CancellationToken ct, bool force = false) =>
		Task.Run(() =>
		{
			var local = path.TrimEnd('\\');
			var code = NativeMethods.WNetCancelConnection2W(local, 0, force);
			if (code is NativeMethods.ERROR_SUCCESS or NativeMethods.ERROR_NOT_CONNECTED) return;
			throw new MountException(Describe(code, local), code);
		}, ct);

	/// <summary>True when an unforced disconnect failed because files on the drive are open.</summary>
	public static bool HasOpenFiles(MountException error) =>
		error.Code is NativeMethods.ERROR_OPEN_FILES or NativeMethods.ERROR_DEVICE_IN_USE;

	/// <summary>True when the drive root still maps to a network resource.</summary>
	public static bool IsMounted(string path) => RemoteNameOf(path.TrimEnd('\\')) is not null;

	/// <summary>
	/// Enumerate drives mapped to network shares: the app's own, drives from a previous
	/// run, and ones the user mapped. AppState decides which are an Umbrel's, verifying
	/// hosts before trusting a drive it didn't map or adopt itself.
	/// </summary>
	public static IReadOnlyList<MountedShare> MountedShares()
	{
		var found = new List<MountedShare>();
		var mask = NativeMethods.GetLogicalDrives();
		for (var i = 0; i < 26; i++)
		{
			if ((mask & (1u << i)) == 0) continue;
			var local = $"{(char)('A' + i)}:";
			var remote = RemoteNameOf(local);
			if (remote is null) continue;
			var parsed = ParseUnc(remote);
			if (parsed is null) continue;
			found.Add(new MountedShare(parsed.Value.Host, parsed.Value.Share, local + "\\"));
		}
		return found;
	}

	// Only a connected drive has a remote name. ERROR_CONNECTION_UNAVAIL is a drive the
	// user saved to reconnect at sign-in that isn't connected now, so it is neither
	// adopted nor disconnected.
	private static string? RemoteNameOf(string localName)
	{
		var buffer = new char[NativeMethods.MAX_PATH];
		var length = (uint)buffer.Length;
		var code = NativeMethods.WNetGetConnectionW(localName, buffer, ref length);
		if (code == NativeMethods.ERROR_MORE_DATA)
		{
			buffer = new char[length];
			code = NativeMethods.WNetGetConnectionW(localName, buffer, ref length);
		}
		return code == NativeMethods.ERROR_SUCCESS ? NativeMethods.StringFromBuffer(buffer) : null;
	}

	internal static (string Host, string Share)? ParseUnc(string remote)
	{
		if (!remote.StartsWith(@"\\", StringComparison.Ordinal)) return null;
		var parts = remote[2..].Split('\\', StringSplitOptions.RemoveEmptyEntries);
		if (parts.Length < 2) return null;
		return (parts[0], parts[1]);
	}

	internal static string RemoteName(string host, string sharename) => $@"\\{host}\{sharename}";

	// Host comparison is normalized by trimming a trailing dot and lowercasing, so
	// "umbrel.local." matches "UMBREL.LOCAL".
	internal static string NormalizeHost(string host) => host.TrimEnd('.').ToLowerInvariant();

	public static bool HostsMatch(string lhs, string rhs) => NormalizeHost(lhs) == NormalizeHost(rhs);

	/// <summary>
	/// A sharename is used as a UNC path component; refuse anything that could escape it or
	/// that Windows rejects in a name, including a trailing space or period.
	/// </summary>
	internal static void Validate(string sharename)
	{
		if (sharename.Length == 0
			|| sharename is "." or ".."
			|| sharename.Any(c => c < ' ' || ReservedNameCharacters.Contains(c))
			|| sharename.EndsWith(' ')
			|| sharename.EndsWith('.'))
		{
			throw new MountException($"Windows can’t open a shared folder named {sharename}");
		}
	}

	private static void CancelServerConnections(string host)
	{
		// Cancelling by remote name removes only deviceless connections that may hold an
		// old credential; drive letters are unmounted per share by AppState.
		_ = NativeMethods.WNetCancelConnection2W($@"\\{host}", 0, fForce: false);
	}

	// Called right after the failing WNet call on the same thread: WNetGetLastError is
	// kept per thread.
	private static string Describe(uint code, string target) => code switch
	{
		NativeMethods.ERROR_LOGON_FAILURE or NativeMethods.ERROR_INVALID_PASSWORD =>
			$"Windows rejected the share password for {target}",
		NativeMethods.ERROR_ACCESS_DENIED => $"Access to {target} was denied",
		NativeMethods.ERROR_BAD_NETPATH or NativeMethods.ERROR_BAD_NET_NAME or NativeMethods.ERROR_NO_NET_OR_BAD_PATH =>
			$"{target} could not be found on the network",
		NativeMethods.ERROR_NO_NETWORK => "The network is unavailable",
		NativeMethods.ERROR_OPEN_FILES or NativeMethods.ERROR_DEVICE_IN_USE =>
			$"{target} has open files. Close them and try again",
		NativeMethods.ERROR_CANCELLED => "The connection was cancelled",
		NativeMethods.ERROR_SESSION_CREDENTIAL_CONFLICT =>
			"Windows is already connected to this Umbrel with a different username. Disconnect its other drives, then try again.",
		NativeMethods.ERROR_NO_MORE_ITEMS => "There are no free drive letters. Disconnect a drive you don’t need, then try again.",
		NativeMethods.ERROR_EXTENDED_ERROR => ExtendedError(target),
		_ => $"Windows couldn’t use {target} (error {code})",
	};

	private static string ExtendedError(string target)
	{
		Span<char> message = stackalloc char[256];
		Span<char> provider = stackalloc char[256];
		var code = NativeMethods.WNetGetLastErrorW(out _, message, (uint)message.Length, provider, (uint)provider.Length);
		var text = code == NativeMethods.ERROR_SUCCESS ? NativeMethods.StringFromBuffer(message).Trim() : "";
		return text.Length > 0
			? $"{target}: {text}"
			: $"Windows couldn’t use {target} (error {NativeMethods.ERROR_EXTENDED_ERROR})";
	}
}
