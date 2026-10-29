using System.Text.RegularExpressions;

namespace Umbrel.Services;

public sealed record ReleaseNoteRun(string Text, bool Bold);

public sealed record ReleaseNoteLine(bool IsBullet, IReadOnlyList<ReleaseNoteRun> Runs);

/// <summary>
/// A version's release notes as the update window shows them, following the macOS update
/// window: one note per line, a line starting with "• " or "- " shown as a bullet with
/// wrapped lines indented, and inline **bold** kept. Anything else shows as written.
/// </summary>
public sealed partial record ReleaseNotes(string Title, IReadOnlyList<ReleaseNoteLine> Lines)
{
	public static ReleaseNotes Parse(string title, string markdown) =>
		new(title, markdown.Trim().ReplaceLineEndings("\n").Split('\n').Select(ParseLine).ToList());

	private static ReleaseNoteLine ParseLine(string line)
	{
		var isBullet = line.StartsWith("• ", StringComparison.Ordinal) || line.StartsWith("- ", StringComparison.Ordinal);
		if (isBullet) line = line[2..];
		// A link shows only its text. The macOS notes are covered by the appcast's
		// signature, but these are protected by HTTPS alone, so an altered notes file
		// mustn't be able to put a clickable link in front of users.
		line = MarkdownLink().Replace(line, "$1");
		var runs = new List<ReleaseNoteRun>();
		var index = 0;
		foreach (Match bold in MarkdownBold().Matches(line))
		{
			if (bold.Index > index) runs.Add(new ReleaseNoteRun(line[index..bold.Index], false));
			runs.Add(new ReleaseNoteRun(bold.Groups[1].Success ? bold.Groups[1].Value : bold.Groups[2].Value, true));
			index = bold.Index + bold.Length;
		}
		if (index < line.Length) runs.Add(new ReleaseNoteRun(line[index..], false));
		return new ReleaseNoteLine(isBullet, runs);
	}

	[GeneratedRegex(@"\[([^\]]*)\]\([^)]*\)")]
	private static partial Regex MarkdownLink();

	[GeneratedRegex(@"\*\*(.+?)\*\*|__(.+?)__")]
	private static partial Regex MarkdownBold();
}
