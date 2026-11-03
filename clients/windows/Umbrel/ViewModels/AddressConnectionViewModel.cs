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
	// A current Umbrel answered here but couldn't prove its identity.
	private Umbreld.UnverifiedDevice? _unverified;
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
		// umbrelOS may still open in the browser when the app can't verify it.
		OpenUnverifiedCommand = new RelayCommand(() =>
		{
			if (Unverified is not null) Browser.Open($"http://{Unverified.Host}");
		});
	}

	public string Input
	{
		get => _input;
		set
		{
			if (!SetProperty(ref _input, value)) return;
			// A new address makes the last error, update prompt or failed connection stale.
			Error = null;
			UpdateRequiredHost = null;
			Unverified = null;
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
			OnPropertyChanged(nameof(ShowConnect));
		}
	}

	public bool ShowUpdateRequired => UpdateRequiredHost is not null;

	public Umbreld.UnverifiedDevice? Unverified
	{
		get => _unverified;
		private set
		{
			SetProperty(ref _unverified, value);
			OnPropertyChanged(nameof(ShowUnverified));
			OnPropertyChanged(nameof(ShowConnect));
		}
	}

	public bool ShowUnverified => Unverified is not null;

	// The update prompt and the failed connection each replace Connect with their own actions.
	public bool ShowConnect => !ShowUpdateRequired && !ShowUnverified;

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
	public IRelayCommand OpenUnverifiedCommand { get; }

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
			var result = await _state.ConnectByAddressAsync(address, cts.Token);
			// Try again keeps the previous answer on screen until this one arrives.
			Unverified = null;
			switch (result)
			{
				case AddressConnectionResult.Device device:
					_shell.ShowDetail(device.Id);
					break;
				case AddressConnectionResult.Unverified unverified:
					Unverified = unverified.Value;
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
			Unverified = null;
			Error = error.Message;
		}
		finally
		{
			if (ReferenceEquals(_cts, cts)) Busy = false;
		}
	}

	public void Dispose() => _cts?.Cancel();
}
