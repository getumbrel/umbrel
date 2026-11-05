using System.ComponentModel;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using Umbrel.ViewModels;

namespace Umbrel.Views;

public partial class DeviceDetailView : UserControl
{
	private DeviceDetailViewModel? _vm;

	public DeviceDetailView()
	{
		InitializeComponent();
		DataContextChanged += OnDataContextChanged;
	}

	private void OnDataContextChanged(object sender, DependencyPropertyChangedEventArgs e)
	{
		if (_vm is not null) _vm.PropertyChanged -= OnViewModelChanged;
		_vm = e.NewValue as DeviceDetailViewModel;
		if (_vm is not null) _vm.PropertyChanged += OnViewModelChanged;
		Form.Clear();
	}

	// macOS rebuilds the form for each account (.id(account.userId)) and whenever it leaves
	// the page. Here it stays in the tree, so empty it at those points instead.
	private void OnViewModelChanged(object? sender, PropertyChangedEventArgs e)
	{
		if (_vm is null) return;
		if (e.PropertyName == nameof(DeviceDetailViewModel.SelectedUserId)
			|| (e.PropertyName == nameof(DeviceDetailViewModel.ShowSignInForm) && !_vm.ShowSignInForm))
		{
			Form.Clear();
		}
	}

	// Reconnecting forgets the Umbrel, so the next sign-in trusts whatever answers then. It
	// asks first, with Cancel as the default.
	private void Reconnect_Click(object sender, RoutedEventArgs e)
	{
		if (_vm is null || _vm.ReconnectCommand.IsRunning) return;
		if (!ConfirmDialog.Show(
			Window.GetWindow(this),
			IdentityChange.ConfirmTitle,
			IdentityChange.ConfirmMessage,
			"Reconnect",
			defaultToCancel: true))
		{
			return;
		}
		_vm.ReconnectCommand.Execute(null);
	}

	// Like macOS, turning HTTPS on asks first; turning it off doesn't.
	private void HttpsToggle_Click(object sender, RoutedEventArgs e)
	{
		if (_vm is null) return;
		var enabled = HttpsToggle.IsChecked == true;
		// The click already flipped the switch; like macOS, it shows the saved value until
		// the user confirms.
		HttpsToggle.GetBindingExpression(ToggleButton.IsCheckedProperty)?.UpdateTarget();
		if (enabled && !ConfirmDialog.Show(
			Window.GetWindow(this),
			"Always use HTTPS locally?",
			"Your browser may show a privacy warning. If it does, open the details and choose the option to continue to your Umbrel. Only do this for your Umbrel and its installed apps.",
			"Use HTTPS locally"))
		{
			return;
		}
		_vm.SetDashboardUsesHttps(enabled);
	}
}
