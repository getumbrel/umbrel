using System.Windows;
using System.Windows.Input;
using Umbrel.ViewModels;

namespace Umbrel.Views;

public partial class UpdateWindow : Window
{
	private readonly UpdateViewModel _model;

	public UpdateWindow(UpdateViewModel model)
	{
		InitializeComponent();
		_model = model;
		DataContext = model;
		PreviewKeyDown += OnPreviewKeyDown;
	}

	// Opens at the first note, even if an earlier version's notes were scrolled.
	private void OnNotesExpanded(object sender, RoutedEventArgs e) => NotesScroller.ScrollToTop();

	// Escape answers the secondary button, or a lone OK. Handled here rather than with
	// IsCancel, which would give Escape two targets when only one button is visible.
	private void OnPreviewKeyDown(object sender, KeyEventArgs e)
	{
		if (e.Key != Key.Escape) return;
		var command = _model.SecondaryButton is null ? _model.PrimaryCommand : _model.SecondaryCommand;
		command.Execute(null);
		e.Handled = true;
	}
}
