using System.Reflection;
using System.Windows;
using System.Windows.Input;

namespace Umbrel.Views;

/// <summary>One About window at a time, like the macOS standard About panel.</summary>
public partial class AboutWindow : Window
{
	private static AboutWindow? _current;

	private AboutWindow()
	{
		InitializeComponent();
		VersionText.Text = $"Version {App.DisplayVersion} ({App.BuildNumber})";
		CopyrightText.Text = Assembly.GetExecutingAssembly().GetCustomAttribute<AssemblyCopyrightAttribute>()?.Copyright ?? "";
		// Escape closes it, as it does other Windows dialogs.
		PreviewKeyDown += (_, e) =>
		{
			if (e.Key != Key.Escape) return;
			Close();
			e.Handled = true;
		};
		Closed += (_, _) => _current = null;
	}

	public static void Present()
	{
		_current ??= new AboutWindow();
		_current.Show();
		_current.Activate();
	}
}
