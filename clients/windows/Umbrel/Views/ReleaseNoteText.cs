using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using Umbrel.Services;

namespace Umbrel.Views;

/// <summary>Fills a TextBlock with a release note's runs; TextBlock.Inlines can't be bound.</summary>
public static class ReleaseNoteText
{
	public static readonly DependencyProperty RunsProperty = DependencyProperty.RegisterAttached(
		"Runs", typeof(IReadOnlyList<ReleaseNoteRun>), typeof(ReleaseNoteText), new PropertyMetadata(null, OnRunsChanged));

	public static IReadOnlyList<ReleaseNoteRun>? GetRuns(TextBlock element) =>
		(IReadOnlyList<ReleaseNoteRun>?)element.GetValue(RunsProperty);

	public static void SetRuns(TextBlock element, IReadOnlyList<ReleaseNoteRun>? value) => element.SetValue(RunsProperty, value);

	private static void OnRunsChanged(DependencyObject element, DependencyPropertyChangedEventArgs e)
	{
		if (element is not TextBlock text) return;
		text.Inlines.Clear();
		foreach (var run in (IReadOnlyList<ReleaseNoteRun>?)e.NewValue ?? [])
		{
			text.Inlines.Add(new Run(run.Text) { FontWeight = run.Bold ? FontWeights.Bold : FontWeights.Normal });
		}
	}
}
