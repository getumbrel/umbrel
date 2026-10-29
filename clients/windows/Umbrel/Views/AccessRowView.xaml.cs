using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Threading;
using Umbrel.Services;
using Umbrel.ViewModels;

namespace Umbrel.Views;

public sealed partial class AccessRowView : UserControl
{
	// Like macOS, the checkmark shows for 1.5 s after copying.
	private readonly DispatcherTimer _copiedTimer = new() { Interval = TimeSpan.FromSeconds(1.5) };

	public AccessRowView()
	{
		InitializeComponent();
		_copiedTimer.Tick += (_, _) => ShowCopied(false);
	}

	private void Open_Click(object sender, RoutedEventArgs e)
	{
		if (DataContext is AccessRow row) Browser.Open(row.Url);
	}

	private void Copy_Click(object sender, RoutedEventArgs e)
	{
		if (DataContext is not AccessRow row) return;
		try
		{
			Clipboard.SetText(row.Url);
		}
		catch (ExternalException)
		{
			// Another app holds the clipboard open; don't claim the copy worked.
			return;
		}
		ShowCopied(true);
	}

	private void ShowCopied(bool copied)
	{
		_copiedTimer.Stop();
		if (copied) _copiedTimer.Start();
		CopyGlyph.Text = copied ? "" : "";
		CopyButton.ToolTip = copied ? "Copied" : "Copy address";
		AutomationProperties.SetName(CopyButton, copied ? "Address copied" : "Copy address");
	}
}
