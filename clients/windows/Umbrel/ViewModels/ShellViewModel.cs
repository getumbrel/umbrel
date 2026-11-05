using System.ComponentModel;
using System.Windows;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Umbrel.Views;

namespace Umbrel.ViewModels;

/// <summary>Owns which page the panel shows: the device list, one device, or connect by address.</summary>
public sealed class ShellViewModel : ObservableObject
{
	private readonly DeviceListViewModel _list;
	private object _current;
	private bool _autoSelected;

	public ShellViewModel(AppState state)
	{
		State = state;
		_list = new DeviceListViewModel(state, this);
		_current = _list;
		AboutCommand = new RelayCommand(AboutWindow.Present);
		// Not an AsyncRelayCommand: the update window outlives the check, and Updates
		// decides when another check may start.
		CheckForUpdatesCommand = new RelayCommand(() => _ = Updates.CheckForUpdatesAsync());
		QuitCommand = new RelayCommand(Quit);
		state.PropertyChanged += OnStateChanged;
	}

	public AppState State { get; }

	public UpdateViewModel Updates { get; } = new();

	public object Current
	{
		get => _current;
		private set => SetProperty(ref _current, value);
	}

	public bool IsQuitting { get; private set; }

	public IRelayCommand AboutCommand { get; }
	public IRelayCommand CheckForUpdatesCommand { get; }
	public IRelayCommand QuitCommand { get; }

	public void ShowList()
	{
		if (Current is DeviceDetailViewModel detail)
		{
			detail.Dispose();
			if (State.IsUnsavedManualOnlyDevice(detail.DeviceId)) State.DiscardUnsavedManualDevice(detail.DeviceId);
		}
		if (Current is AddressConnectionViewModel address) address.Dispose();
		Current = _list;
	}

	public void ShowDetail(string deviceId)
	{
		if (Current is DeviceDetailViewModel existing && existing.DeviceId == deviceId) return;
		if (Current is DeviceDetailViewModel detail) detail.Dispose();
		if (Current is AddressConnectionViewModel address) address.Dispose();
		Current = new DeviceDetailViewModel(deviceId, State, this);
	}

	public void ShowAddress()
	{
		if (Current is DeviceDetailViewModel detail) detail.Dispose();
		Current = new AddressConnectionViewModel(State, this);
	}

	/// <summary>A single saved device opens directly, once per app run.</summary>
	public void PanelWillPresent()
	{
		if (_autoSelected) return;
		var saved = State.SavedDevices.Keys.ToList();
		if (saved.Count == 1)
		{
			_autoSelected = true;
			ShowDetail(saved[0]);
		}
	}

	private void OnStateChanged(object? sender, PropertyChangedEventArgs e)
	{
		if (e.PropertyName is not (nameof(AppState.Devices) or null)) return;
		if (Current is DeviceDetailViewModel detail && State.Device(detail.DeviceId) is null && !State.SavedDevices.ContainsKey(detail.DeviceId))
		{
			ShowList();
		}
	}

	private void Quit()
	{
		IsQuitting = true;
		// Mapped drives deliberately survive exit; nothing is disconnected here.
		Application.Current.Shutdown();
	}
}
