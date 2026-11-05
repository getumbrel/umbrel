using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;

namespace Umbrel.Views;

/// <summary>A login attempt from PasswordForm. Totp is set only once the account requires a 2FA code.</summary>
public sealed record PasswordSubmission(string Password, string? Totp);

public sealed partial class PasswordForm : UserControl
{
	public static readonly DependencyProperty LabelProperty = DependencyProperty.Register(
		nameof(Label), typeof(string), typeof(PasswordForm), new PropertyMetadata(""));

	public static readonly DependencyProperty RequiresTotpProperty = DependencyProperty.Register(
		nameof(RequiresTotp), typeof(bool), typeof(PasswordForm),
		new PropertyMetadata(false, (sender, _) => ((PasswordForm)sender).FocusActiveField()));

	public static readonly DependencyProperty LoadingProperty = DependencyProperty.Register(
		nameof(Loading), typeof(bool), typeof(PasswordForm),
		new PropertyMetadata(false, (sender, _) => ((PasswordForm)sender).OnLoadingChanged()));

	public static readonly DependencyProperty ErrorProperty = DependencyProperty.Register(
		nameof(Error), typeof(string), typeof(PasswordForm),
		new PropertyMetadata(null, (sender, _) => ((PasswordForm)sender).OnErrorChanged()));

	public static readonly DependencyProperty SubmitCommandProperty = DependencyProperty.Register(
		nameof(SubmitCommand), typeof(ICommand), typeof(PasswordForm));

	public static readonly DependencyProperty EditedCommandProperty = DependencyProperty.Register(
		nameof(EditedCommand), typeof(ICommand), typeof(PasswordForm));

	private bool _revealed;

	public PasswordForm()
	{
		InitializeComponent();
		IsVisibleChanged += (_, _) =>
		{
			if (IsVisible) FocusActiveField();
		};
	}

	public string Label
	{
		get => (string)GetValue(LabelProperty);
		set => SetValue(LabelProperty, value);
	}

	public bool RequiresTotp
	{
		get => (bool)GetValue(RequiresTotpProperty);
		set => SetValue(RequiresTotpProperty, value);
	}

	public bool Loading
	{
		get => (bool)GetValue(LoadingProperty);
		set => SetValue(LoadingProperty, value);
	}

	public string? Error
	{
		get => (string?)GetValue(ErrorProperty);
		set => SetValue(ErrorProperty, value);
	}

	/// <summary>Executed with a <see cref="PasswordSubmission"/>.</summary>
	public ICommand? SubmitCommand
	{
		get => (ICommand?)GetValue(SubmitCommandProperty);
		set => SetValue(SubmitCommandProperty, value);
	}

	/// <summary>Executed with no parameter when a code is typed while an error shows, so the owner can clear it.</summary>
	public ICommand? EditedCommand
	{
		get => (ICommand?)GetValue(EditedCommandProperty);
		set => SetValue(EditedCommandProperty, value);
	}

	/// <summary>Resets the password, the code, and the reveal toggle.</summary>
	public void Clear()
	{
		_revealed = false;
		PasswordField.Clear();
		RevealedField.Clear();
		CodeField.Clear();
		UpdateReveal();
	}

	// Only the visible field holds the password; the reveal toggle moves it across.
	private string Password => _revealed ? RevealedField.Text : PasswordField.Password;

	private Control ActiveField => RequiresTotp ? CodeField : _revealed ? RevealedField : PasswordField;

	// Deferred to Input priority so it runs after layout, once a newly shown field can take focus.
	private void FocusActiveField() => Dispatcher.BeginInvoke(DispatcherPriority.Input, () =>
	{
		var field = ActiveField;
		if (!field.Focus()) return;
		// Setting PasswordBox.Password puts the caret at the start.
		EditingCommands.MoveToDocumentEnd.Execute(null, field);
	});

	private void OnLoadingChanged()
	{
		PasswordCapsule.IsEnabled = !Loading;
		CodeRow.IsEnabled = !Loading;
		// WPF moves focus off a disabled field. On the Mac the password field keeps it through a request.
		if (!Loading) FocusActiveField();
	}

	private void OnErrorChanged()
	{
		UpdateOutlines();
		// A rejected code starts over, as on the Mac.
		if (!RequiresTotp || Error is null) return;
		CodeField.Clear();
		FocusActiveField();
	}

	private void Submit()
	{
		var password = Password;
		var code = CodeField.Text;
		if (password.Length == 0 || Loading || (RequiresTotp && code.Length != 6)) return;
		Run(SubmitCommand, new PasswordSubmission(password, RequiresTotp ? code : null));
	}

	private static void Run(ICommand? command, object? parameter)
	{
		if (command?.CanExecute(parameter) == true) command.Execute(parameter);
	}

	private void UpdatePlaceholder() =>
		Placeholder.Visibility = Password.Length == 0 ? Visibility.Visible : Visibility.Collapsed;

	private void UpdateReveal()
	{
		PasswordField.Visibility = _revealed ? Visibility.Collapsed : Visibility.Visible;
		RevealedField.Visibility = _revealed ? Visibility.Visible : Visibility.Collapsed;
		// Segoe Fluent Icons Hide and RedEye, matching the Mac's eye.slash and eye.
		RevealGlyph.Text = _revealed ? "" : "";
		AutomationProperties.SetName(RevealButton, _revealed ? "Hide password" : "Show password");
		UpdatePlaceholder();
	}

	private void UpdateOutlines()
	{
		var red = (Brush)FindResource("RedBrush");
		var hairline = (Brush)FindResource("HairlineBrush");
		PasswordCapsule.BorderBrush = Error is null ? hairline : red;

		var code = CodeField.Text;
		// The highlight marks the next digit and stays on the last slot once all six are in.
		var active = Math.Min(code.Length, Slots.Children.Count - 1);
		for (var i = 0; i < Slots.Children.Count; i++)
		{
			var slot = (Border)Slots.Children[i];
			((TextBlock)slot.Child).Text = i < code.Length ? code[i].ToString() : "";
			slot.BorderBrush = Error is not null ? red
				: CodeField.IsKeyboardFocused && i == active ? (Brush)FindResource("ActiveSlotBrush")
				: hairline;
		}
	}

	private void PasswordField_PasswordChanged(object sender, RoutedEventArgs e) => UpdatePlaceholder();

	private void RevealedField_TextChanged(object sender, TextChangedEventArgs e) => UpdatePlaceholder();

	private void RevealButton_Click(object sender, RoutedEventArgs e)
	{
		_revealed = !_revealed;
		if (_revealed)
		{
			RevealedField.Text = PasswordField.Password;
			PasswordField.Clear();
		}
		else
		{
			PasswordField.Password = RevealedField.Text;
			RevealedField.Clear();
		}
		UpdateReveal();
		FocusActiveField();
	}

	private void CodeField_TextChanged(object sender, TextChangedEventArgs e)
	{
		// Digits only, at most six. Pasted text is filtered rather than cut by MaxLength first.
		var code = new string(CodeField.Text.Where(char.IsAsciiDigit).Take(6).ToArray());
		if (CodeField.Text != code)
		{
			// Setting the cleaned text raises this handler again, which does the rest.
			CodeField.Text = code;
			CodeField.CaretIndex = code.Length;
			return;
		}
		if (Error is not null && code.Length > 0) Run(EditedCommand, null);
		UpdateOutlines();
		if (code.Length == 6) Submit();
	}

	private void CodeField_IsKeyboardFocusedChanged(object sender, DependencyPropertyChangedEventArgs e) => UpdateOutlines();

	private void Field_KeyDown(object sender, KeyEventArgs e)
	{
		if (e.Key != Key.Enter) return;
		e.Handled = true;
		Submit();
	}
}
