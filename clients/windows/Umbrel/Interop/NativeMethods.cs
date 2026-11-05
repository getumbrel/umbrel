using System.Runtime.InteropServices;
using System.Runtime.InteropServices.Marshalling;

// Load the Windows DLLs the app calls into (mpr, shell32, user32, comctl32) only from
// System32. Otherwise Windows checks the app's own folder first, and an unpackaged test
// build unzipped into Downloads would load a planted mpr.dll from there.
[assembly: DefaultDllImportSearchPaths(DllImportSearchPath.System32)]

namespace Umbrel.Interop;

/// <summary>
/// Win32 declarations, adapted from the documented C signatures.
///
/// Every entry point uses the source-generated LibraryImport marshaller (.NET 7+),
/// which the runtime team recommends over DllImport. The generator only accepts
/// blittable structs, so the shell and WNet structures are declared with fixed
/// character buffers and raw pointers instead of MarshalAs annotations.
/// </summary>
internal static unsafe partial class NativeMethods
{
	public const uint WM_APP = 0x8000;
	public const uint WM_CONTEXTMENU = 0x007B;
	public const uint NIN_SELECT = 0x0400;
	public const uint NIN_KEYSELECT = 0x0401;

	public const uint NIM_ADD = 0x0;
	public const uint NIM_MODIFY = 0x1;
	public const uint NIM_DELETE = 0x2;
	public const uint NIM_SETVERSION = 0x4;

	public const uint NIF_MESSAGE = 0x1;
	public const uint NIF_ICON = 0x2;
	public const uint NIF_TIP = 0x4;
	public const uint NIF_INFO = 0x10;
	public const uint NIF_SHOWTIP = 0x80;
	public const uint NIIF_INFO = 0x1;
	public const uint NOTIFYICON_VERSION_4 = 4;

	public const uint IMAGE_ICON = 1;
	public const uint LR_LOADFROMFILE = 0x10;
	public const int SM_CXSMICON = 49;
	public const int SM_CYSMICON = 50;

	[StructLayout(LayoutKind.Sequential)]
	public struct NOTIFYICONDATAW
	{
		public uint cbSize;
		public IntPtr hWnd;
		public uint uID;
		public uint uFlags;
		public uint uCallbackMessage;
		public IntPtr hIcon;
		public fixed char szTip[128];
		public uint dwState;
		public uint dwStateMask;
		public fixed char szInfo[256];
		public uint uTimeoutOrVersion; // union { UINT uTimeout; UINT uVersion; }
		public fixed char szInfoTitle[64];
		public uint dwInfoFlags;
		public Guid guidItem;
		public IntPtr hBalloonIcon;

		public void SetTip(string value)
		{
			fixed (char* buffer = szTip) CopyString(value, buffer, 128);
		}

		public void SetInfo(string value)
		{
			fixed (char* buffer = szInfo) CopyString(value, buffer, 256);
		}

		public void SetInfoTitle(string value)
		{
			fixed (char* buffer = szInfoTitle) CopyString(value, buffer, 64);
		}

		private static void CopyString(string value, char* buffer, int capacity)
		{
			var length = Math.Min(value.Length, capacity - 1);
			value.AsSpan(0, length).CopyTo(new Span<char>(buffer, capacity));
			buffer[length] = '\0';
		}
	}

	[StructLayout(LayoutKind.Sequential)]
	public struct NOTIFYICONIDENTIFIER
	{
		public uint cbSize;
		public IntPtr hWnd;
		public uint uID;
		public Guid guidItem;
	}

	[StructLayout(LayoutKind.Sequential)]
	public struct RECT
	{
		public int left, top, right, bottom;
	}

	public const uint MONITOR_DEFAULTTOPRIMARY = 1;

	[StructLayout(LayoutKind.Sequential)]
	public struct MONITORINFO
	{
		public uint cbSize;
		public RECT rcMonitor;
		public RECT rcWork;
		public uint dwFlags;
	}

	[LibraryImport("user32.dll")]
	public static partial IntPtr MonitorFromRect(ref RECT rect, uint flags);

	[LibraryImport("user32.dll")]
	[return: MarshalAs(UnmanagedType.Bool)]
	public static partial bool GetMonitorInfoW(IntPtr monitor, ref MONITORINFO info);

	public const int WM_WINDOWPOSCHANGING = 0x0046;
	public const uint SWP_NOSIZE = 0x0001;
	public const uint SWP_NOMOVE = 0x0002;

	[StructLayout(LayoutKind.Sequential)]
	public struct WINDOWPOS
	{
		public IntPtr hwnd;
		public IntPtr hwndInsertAfter;
		public int x, y, cx, cy;
		public uint flags;
	}

	[LibraryImport("shell32.dll", SetLastError = true)]
	[return: MarshalAs(UnmanagedType.Bool)]
	public static partial bool Shell_NotifyIconW(uint dwMessage, ref NOTIFYICONDATAW lpData);

	[LibraryImport("shell32.dll")]
	public static partial int Shell_NotifyIconGetRect(ref NOTIFYICONIDENTIFIER identifier, out RECT iconLocation);

	[LibraryImport("user32.dll", StringMarshalling = StringMarshalling.Utf16)]
	public static partial uint RegisterWindowMessageW(string lpString);

	[LibraryImport("user32.dll", StringMarshalling = StringMarshalling.Utf16, SetLastError = true)]
	public static partial IntPtr LoadImageW(IntPtr hInst, string name, uint type, int cx, int cy, uint fuLoad);

	[LibraryImport("user32.dll")]
	[return: MarshalAs(UnmanagedType.Bool)]
	public static partial bool DestroyIcon(IntPtr hIcon);

	[LibraryImport("user32.dll")]
	public static partial int GetSystemMetrics(int nIndex);

	[LibraryImport("user32.dll")]
	[return: MarshalAs(UnmanagedType.Bool)]
	public static partial bool SetForegroundWindow(IntPtr hWnd);

	[LibraryImport("user32.dll")]
	[return: MarshalAs(UnmanagedType.Bool)]
	public static partial bool IsWindowEnabled(IntPtr hWnd);

	// ── Shortcut menu ──

	public const uint MF_STRING = 0x0;
	public const uint MF_GRAYED = 0x1;
	public const uint MF_CHECKED = 0x8;
	public const uint MF_SEPARATOR = 0x800;
	public const uint TPM_LEFTALIGN = 0x0;
	public const uint TPM_RIGHTBUTTON = 0x2;
	public const uint TPM_RIGHTALIGN = 0x8;
	public const uint TPM_BOTTOMALIGN = 0x20;
	public const uint TPM_RETURNCMD = 0x100;
	public const int SM_MENUDROPALIGNMENT = 40;

	[LibraryImport("user32.dll", SetLastError = true)]
	public static partial IntPtr CreatePopupMenu();

	[LibraryImport("user32.dll")]
	[return: MarshalAs(UnmanagedType.Bool)]
	public static partial bool DestroyMenu(IntPtr hMenu);

	[LibraryImport("user32.dll", StringMarshalling = StringMarshalling.Utf16)]
	[return: MarshalAs(UnmanagedType.Bool)]
	public static partial bool AppendMenuW(IntPtr hMenu, uint uFlags, nuint uIDNewItem, string? lpNewItem);

	// With TPM_RETURNCMD the result is the chosen item's id, or 0 when cancelled.
	[LibraryImport("user32.dll")]
	public static partial uint TrackPopupMenuEx(IntPtr hMenu, uint uFlags, int x, int y, IntPtr hwnd, IntPtr lptpm);

	// ── WNet (mpr.dll) ──

	public const int MAX_PATH = 260;
	public const uint RESOURCETYPE_DISK = 0x1;
	public const uint CONNECT_TEMPORARY = 0x4;
	public const uint CONNECT_REDIRECT = 0x80;
	public const uint WNNC_NET_LANMAN = 0x00020000;

	public const uint ERROR_SUCCESS = 0;
	public const uint ERROR_ACCESS_DENIED = 5;
	public const uint ERROR_BAD_NETPATH = 53;
	public const uint ERROR_BAD_NET_NAME = 67;
	public const uint ERROR_INVALID_PASSWORD = 86;
	public const uint ERROR_MORE_DATA = 234;
	public const uint ERROR_NO_MORE_ITEMS = 259;
	public const uint ERROR_CONNECTION_UNAVAIL = 1201;
	public const uint ERROR_NO_NET_OR_BAD_PATH = 1203;
	public const uint ERROR_EXTENDED_ERROR = 1208;
	public const uint ERROR_SESSION_CREDENTIAL_CONFLICT = 1219;
	public const uint ERROR_NO_NETWORK = 1222;
	public const uint ERROR_CANCELLED = 1223;
	public const uint ERROR_NOT_CONNECTED = 2250;
	public const uint ERROR_OPEN_FILES = 2401;
	public const uint ERROR_DEVICE_IN_USE = 2404;
	public const uint ERROR_LOGON_FAILURE = 1326;

	/// <summary>Blittable NETRESOURCEW; string members are pinned by the caller.</summary>
	[StructLayout(LayoutKind.Sequential)]
	public struct NETRESOURCEW
	{
		public uint dwScope;
		public uint dwType;
		public uint dwDisplayType;
		public uint dwUsage;
		public char* lpLocalName;
		public char* lpRemoteName;
		public char* lpComment;
		public char* lpProvider;
	}

	// See Mounter.MountAsync: password and user are never null or empty here.
	[LibraryImport("mpr.dll", StringMarshalling = StringMarshalling.Utf16)]
	public static partial uint WNetUseConnectionW(
		IntPtr hwndOwner,
		ref NETRESOURCEW lpNetResource,
		string lpPassword,
		string lpUserID,
		uint dwFlags,
		Span<char> lpAccessName,
		ref uint lpBufferSize,
		out uint lpResult);

	[LibraryImport("mpr.dll", StringMarshalling = StringMarshalling.Utf16)]
	public static partial uint WNetCancelConnection2W(string lpName, uint dwFlags, [MarshalAs(UnmanagedType.Bool)] bool fForce);

	[LibraryImport("mpr.dll", StringMarshalling = StringMarshalling.Utf16)]
	public static partial uint WNetGetConnectionW(string lpLocalName, Span<char> lpRemoteName, ref uint lpnLength);

	[LibraryImport("mpr.dll", StringMarshalling = StringMarshalling.Utf16)]
	public static partial uint WNetGetLastErrorW(
		out uint lpError,
		Span<char> lpErrorBuf,
		uint nErrorBufSize,
		Span<char> lpNameBuf,
		uint nNameBufSize);

	[LibraryImport("mpr.dll", StringMarshalling = StringMarshalling.Utf16)]
	public static partial uint WNetGetProviderNameW(uint dwNetType, Span<char> lpProviderName, ref uint lpBufferSize);

	[LibraryImport("kernel32.dll")]
	public static partial uint GetLogicalDrives();

	// ── Package identity (appmodel.h) ──

	public const int APPMODEL_ERROR_NO_PACKAGE = 15700;

	[LibraryImport("kernel32.dll")]
	public static partial int GetCurrentPackageFullName(ref uint packageFullNameLength, IntPtr packageFullName);

	/// <summary>True when the process runs with MSIX package identity.</summary>
	public static bool HasPackageIdentity()
	{
		uint length = 0;
		var result = GetCurrentPackageFullName(ref length, IntPtr.Zero);
		return result != APPMODEL_ERROR_NO_PACKAGE;
	}

	/// <summary>Reads a NUL-terminated string from a buffer the callee filled.</summary>
	public static string StringFromBuffer(ReadOnlySpan<char> buffer)
	{
		var end = buffer.IndexOf('\0');
		return new string(end < 0 ? buffer : buffer[..end]);
	}
}
