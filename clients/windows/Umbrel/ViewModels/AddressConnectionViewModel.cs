using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Umbrel.Services;
using Umbrel.Core;

namespace Umbrel.ViewModels;

public sealed class AddressConnectionViewModel : ObservableObject, IDisposable
{
	private readonly AppState _state;
	private readonly ShellViewModel _shell;
	private CancellationTokenSource? _cts;
	private string _input = "";
	private string? _error;
	private string? _updateRequiredHost;
	private bool _busy;

	public AddressConnectionViewModel(AppState state, ShellViewModel shell)
	{
		_state = state;
		_shell = shell;
		ConnectCommand = new AsyncRelayCommand(ConnectAsync, () => !Busy && !string.IsNullOrWhiteSpace(Input));
		BackCommand = new RelayCommand(() =>
		{
			_cts?.Cancel();
			shell.ShowList();
		});
		OpenUpdateRequiredCommand = new RelayCommand(() =>
		{
			if (UpdateRequiredHost is not null) Browser.Open($"http://{UpdateRequiredHost}");
		});
	}

	public string Input
	{
		get => _input;
		set
		{
			if (!SetProperty(ref _input, value)) return;
			// A new address makes the last error or update prompt stale.
			Error = null;
			UpdateRequiredHost = null;
			ConnectCommand.NotifyCanExecuteChanged();
		}
	}

	public string? Error
	{
		get => _error;
		private set
		{
			SetProperty(ref _error, value);
			OnPropertyChanged(nameof(HasError));
		}
	}

	public bool HasError => Error is not null;

	public string? UpdateRequiredHost
	{
		get => _updateRequiredHost;
		private set
		{
			SetProperty(ref _updateRequiredHost, value);
			OnPropertyChanged(nameof(ShowUpdateRequired));
		}
	}

	public bool ShowUpdateRequired => UpdateRequiredHost is not null;

	public bool Busy
	{
		get => _busy;
		private set
		{
			SetProperty(ref _busy, value);
			ConnectCommand.NotifyCanExecuteChanged();
		}
	}

	public IAsyncRelayCommand ConnectCommand { get; }
	public IRelayCommand BackCommand { get; }
	public IRelayCommand OpenUpdateRequiredCommand { get; }

	private async Task ConnectAsync()
	{
		var address = Input.Trim();
		if (address.Length == 0 || Busy) return;
		_cts?.Cancel();
		var cts = new CancellationTokenSource();
		_cts = cts;
		Busy = true;
		Error = null;
		UpdateRequiredHost = null;
		try
		{
			switch (await _state.ConnectByAddressAsync(address, cts.Token))
			{
				case AddressConnectionResult.Device device:
					_shell.ShowDetail(device.Id);
					break;
				case AddressConnectionResult.UpdateRequired update:
					UpdateRequiredHost = update.Host;
					break;
			}
		}
		catch (OperationCanceledException)
		{
		}
		catch (Exception error)
		{
			Error = error.Message;
		}
		finally
		{
			if (ReferenceEquals(_cts, cts)) Busy = false;
		}
	}

	public void Dispose() => _cts?.Cancel();
}
