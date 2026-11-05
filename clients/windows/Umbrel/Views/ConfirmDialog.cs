using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;

namespace Umbrel.Views;

/// <summary>
/// A confirmation with a labelled confirm button and the system Cancel button, like a
/// macOS alert. WPF's MessageBox only has fixed button sets; TaskDialogIndirect takes
/// custom button text and needs comctl32 v6, which app.manifest selects.
/// </summary>
internal static unsafe partial class ConfirmDialog
{
	private const int IDOK = 1;
	private const int IDCANCEL = 2;
	private const int TDF_POSITION_RELATIVE_TO_WINDOW = 0x1000;
	private const int TDCBF_CANCEL_BUTTON = 0x8;

	// defaultToCancel makes Enter cancel, for a confirmation the user should only give
	// deliberately.
	public static bool Show(Window? owner, string title, string message, string confirm, bool defaultToCancel = false)
	{
		var hwnd = owner is null ? IntPtr.Zero : new WindowInteropHelper(owner).Handle;
		fixed (char* windowTitle = "Umbrel", instruction = title, content = message, confirmText = confirm)
		{
			// Custom buttons sit before the common ones, so Cancel ends up on the right.
			var button = new TASKDIALOG_BUTTON { nButtonID = IDOK, pszButtonText = confirmText };
			var config = new TASKDIALOGCONFIG
			{
				cbSize = (uint)sizeof(TASKDIALOGCONFIG),
				hwndParent = hwnd,
				dwFlags = TDF_POSITION_RELATIVE_TO_WINDOW,
				dwCommonButtons = TDCBF_CANCEL_BUTTON,
				pszWindowTitle = windowTitle,
				pszMainInstruction = instruction,
				pszContent = content,
				cButtons = 1,
				pButtons = &button,
				nDefaultButton = defaultToCancel ? IDCANCEL : IDOK,
			};
			int pressed;
			return TaskDialogIndirect(&config, &pressed, null, null) >= 0 && pressed == IDOK;
		}
	}

	// commctrl.h declares both structures inside pshpack1.h.
	[StructLayout(LayoutKind.Sequential, Pack = 1)]
	private struct TASKDIALOG_BUTTON
	{
		public int nButtonID;
		public char* pszButtonText;
	}

	[StructLayout(LayoutKind.Sequential, Pack = 1)]
	private struct TASKDIALOGCONFIG
	{
		public uint cbSize;
		public IntPtr hwndParent;
		public IntPtr hInstance;
		public int dwFlags;
		public int dwCommonButtons;
		public char* pszWindowTitle;
		public IntPtr pszMainIcon; // union { HICON hMainIcon; PCWSTR pszMainIcon; }
		public char* pszMainInstruction;
		public char* pszContent;
		public uint cButtons;
		public TASKDIALOG_BUTTON* pButtons;
		public int nDefaultButton;
		public uint cRadioButtons;
		public IntPtr pRadioButtons;
		public int nDefaultRadioButton;
		public IntPtr pszVerificationText;
		public IntPtr pszExpandedInformation;
		public IntPtr pszExpandedControlText;
		public IntPtr pszCollapsedControlText;
		public IntPtr pszFooterIcon; // union { HICON hFooterIcon; PCWSTR pszFooterIcon; }
		public IntPtr pszFooter;
		public IntPtr pfCallback;
		public IntPtr lpCallbackData;
		public uint cxWidth;
	}

	[LibraryImport("comctl32.dll")]
	private static partial int TaskDialogIndirect(TASKDIALOGCONFIG* pTaskConfig, int* pnButton, int* pnRadioButton, int* pfVerificationFlagChecked);
}
