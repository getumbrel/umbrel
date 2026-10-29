using System.Diagnostics;

namespace Umbrel.Services;

internal static class Browser
{
	/// <summary>Open http(s) URLs and local folders through the shell's default handler.</summary>
	// On the thread pool: the shell looks the target up first, and a drive whose Umbrel went
	// offline can stall that for tens of seconds. Off an STA thread, .NET runs the shell call
	// on an STA thread of its own.
	public static void Open(string target) => Task.Run(() =>
	{
		try
		{
			Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
		}
		catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or InvalidOperationException)
		{
		}
	});

	public static void Open(Uri uri) => Open(uri.AbsoluteUri);
}
