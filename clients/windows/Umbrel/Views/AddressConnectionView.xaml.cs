using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using Umbrel.ViewModels;

namespace Umbrel.Views;

public partial class AddressConnectionView : UserControl
{
	public AddressConnectionView()
	{
		InitializeComponent();
		Loaded += (_, _) => AddressBox.Focus();
	}

	private void AddressBox_KeyDown(object sender, KeyEventArgs e)
	{
		if (e.Key != Key.Enter || DataContext is not AddressConnectionViewModel vm) return;
		vm.ConnectCommand.Execute(null);
		e.Handled = true;
	}

	// The field is disabled while connecting, which drops focus. After a failure, hand it
	// back so the address can be corrected right away, or Enter can try again.
	private void AddressBox_IsEnabledChanged(object sender, DependencyPropertyChangedEventArgs e)
	{
		if (AddressBox.IsEnabled && DataContext is AddressConnectionViewModel { HasError: true } or AddressConnectionViewModel { ShowUnverified: true })
		{
			AddressBox.Focus();
		}
	}
}
