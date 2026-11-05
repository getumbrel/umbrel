using System.Diagnostics;
using System.IO;
using Umbrel.Core;

namespace Umbrel.Services;

/// <summary>
/// Keeps the app's Trace warnings in %LOCALAPPDATA%\Umbrel\logs, the counterpart of the
/// macOS app's unified log entries. A plain file because registering an Event Log source
/// needs admin rights (and MSIX blocks it) and ETW keeps nothing unless someone is
/// collecting. Under MSIX the folder is redirected into the package's LocalCache.
/// </summary>
public sealed class FileLog : TraceListener
{
	// 1 MB plus one rotated file covers weeks of warnings.
	private const long MaximumBytes = 1_000_000;

	private readonly string _path;

	private FileLog(string path) => _path = path;

	public static void Start(string directory) =>
		Trace.Listeners.Add(new FileLog(Path.Combine(directory, "logs", "umbrel.log")));

	/// <summary>
	/// The exception's type and code. Messages can name hosts, \\host\share paths and share
	/// names, which stay out of the log as the macOS app keeps them private.
	/// </summary>
	public static string Describe(Exception error) => error switch
	{
		MountException mount => $"{nameof(MountException)} {mount.Code}",
		UmbreldException api => $"{nameof(UmbreldException)} {api.Kind} {api.Status}",
		_ => $"{error.GetType().Name} 0x{error.HResult:X8}",
	};

	public override void TraceEvent(TraceEventCache? eventCache, string source, TraceEventType eventType, int id, string? message) =>
		Append(eventType, message);

	public override void TraceEvent(TraceEventCache? eventCache, string source, TraceEventType eventType, int id, string? format, params object?[]? args) =>
		Append(eventType, args is null || format is null ? format : string.Format(format, args));

	public override void Write(string? message) => Append(TraceEventType.Verbose, message);

	public override void WriteLine(string? message) => Append(TraceEventType.Verbose, message);

	// Trace calls listeners under its global lock (IsThreadSafe is false), so appends don't
	// interleave. Logging must never take the app down, so failures are dropped.
	private void Append(TraceEventType type, string? message)
	{
		try
		{
			Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
			if (File.Exists(_path) && new FileInfo(_path).Length > MaximumBytes)
			{
				File.Move(_path, Path.ChangeExtension(_path, ".1.log"), overwrite: true);
			}
			File.AppendAllText(_path, $"{DateTimeOffset.Now:O} {type} {message}{Environment.NewLine}");
		}
		catch (Exception)
		{
		}
	}
}
