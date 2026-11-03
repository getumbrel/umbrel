using System.ComponentModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Umbrel.Services;
using Umbrel.Core;

namespace Umbrel.ViewModels;

public sealed class DeviceRow(Device device, StatusInfo status) : ObservableObject
{
	public Device Device { get; private set; } = device;
	public string Id => Device.Id;
	public string DisplayName => Device.DisplayName;
	public string Host => Device.Host;
	public UmbrelDeviceKind Kind => Device.Kind;
	public StatusInfo Status { get; private set; } = status;

	public void Update(Device device, StatusInfo status)
	{
		Device = device;
		Status = status;
		OnPropertyChanged(string.Empty);
	}
}

/// <summary>
/// A current Umbrel at a common hostname that answered but couldn't prove its identity. Like
/// an update hint it's not a Device: it can't be selected, authenticated, or saved.
/// </summary>
public sealed class UnverifiedRow(Umbreld.UnverifiedDevice device, bool isRetrying) : ObservableObject
{
	public Umbreld.UnverifiedDevice Device { get; private set; } = device;
	public string Host => Device.Host;
	public string Explanation => Device.Explanation;
	public string Url => $"http://{Device.Host}";
	public bool IsRetrying { get; private set; } = isRetrying;

	public void Update(Umbreld.UnverifiedDevice device, bool isRetrying)
	{
		Device = device;
		IsRetrying = isRetrying;
		OnPropertyChanged(string.Empty);
	}
}

public sealed class UpdateRequiredRow(Umbreld.UpdateRequiredDevice device)
{
	public string Host => device.Host;
	public string Url => $"http://{device.Host}";
}

public sealed class DeviceListViewModel : ObservableObject
{
	private readonly AppState _state;
	private readonly ShellViewModel _shell;
	private IReadOnlyList<DeviceRow> _rows = [];
	private IReadOnlyList<UnverifiedRow> _unverifiedRows = [];
	private IReadOnlyList<UpdateRequiredRow> _updateRows = [];
	private IReadOnlyList<Device> _rowSource = [];
	private IReadOnlyList<Umbreld.UnverifiedDevice> _unverifiedSource = [];
	private IReadOnlySet<string> _retryingSource = new HashSet<string>();
	private IReadOnlyList<Umbreld.UpdateRequiredDevice> _updateSource = [];
	private DeviceRow? _singleUnsaved;
	private string _subtitle = "";

	public DeviceListViewModel(AppState state, ShellViewModel shell)
	{
		_state = state;
		_shell = shell;
		RefreshCommand = new AsyncRelayCommand(state.RescanAsync);
		SelectCommand = new RelayCommand<DeviceRow>(row =>
		{
			if (row is not null) shell.ShowDetail(row.Id);
		});
		ConnectByAddressCommand = new RelayCommand(shell.ShowAddress);
		RetryUnverifiedCommand = new RelayCommand<UnverifiedRow>(row =>
		{
			if (row is not null) _ = state.RetryAsync(row.Device);
		});
		// umbrelOS may still open in the browser when the app can't verify it.
		OpenUnverifiedCommand = new RelayCommand<UnverifiedRow>(row =>
		{
			if (row is not null) Browser.Open(row.Url);
		});
		OpenUpdateRequiredCommand = new RelayCommand<UpdateRequiredRow>(row =>
		{
			if (row is not null) Browser.Open(row.Url);
		});
		state.PropertyChanged += OnStateChanged;
		Recompute();
	}

	public IReadOnlyList<DeviceRow> Rows
	{
		get => _rows;
		private set => SetProperty(ref _rows, value);
	}

	public IReadOnlyList<UnverifiedRow> UnverifiedRows
	{
		get => _unverifiedRows;
		private set => SetProperty(ref _unverifiedRows, value);
	}

	public IReadOnlyList<UpdateRequiredRow> UpdateRows
	{
		get => _updateRows;
		private set => SetProperty(ref _updateRows, value);
	}

	/// <summary>Set when the only result is one unsaved device; it gets the welcome card.</summary>
	public DeviceRow? SingleUnsaved
	{
		get => _singleUnsaved;
		private set => SetProperty(ref _singleUnsaved, value);
	}

	public string Subtitle
	{
		get => _subtitle;
		private set => SetProperty(ref _subtitle, value);
	}

	public bool ShowRefresh => !IsEmpty;
	public bool IsEmpty => Rows.Count == 0 && UnverifiedRows.Count == 0 && UpdateRows.Count == 0;
	public bool Searching => IsEmpty && _state.InitialDiscoveryInProgress;
	public bool Scanning => _state.Scanning;
	/// <summary>Hidden during the first discovery window and while a rescan runs, as on macOS.</summary>
	public bool ShowFooter => !_state.InitialDiscoveryInProgress && !_state.Scanning;
	public string ScanButtonText => Scanning ? "Scanning…" : "Scan network";
	public string WelcomeButtonText => SingleUnsaved?.Device.Onboarded == true ? "Connect" : "Set up";

	public IAsyncRelayCommand RefreshCommand { get; }
	public IRelayCommand<DeviceRow> SelectCommand { get; }
	public IRelayCommand ConnectByAddressCommand { get; }
	public IRelayCommand<UnverifiedRow> RetryUnverifiedCommand { get; }
	public IRelayCommand<UnverifiedRow> OpenUnverifiedCommand { get; }
	public IRelayCommand<UpdateRequiredRow> OpenUpdateRequiredCommand { get; }

	private void OnStateChanged(object? sender, PropertyChangedEventArgs e) => Recompute();

	private void Recompute()
	{
		var listed = _state.Devices
			.Where(device => (device.Saved || device.Online) && !_state.IsUnsavedManualOnlyDevice(device.Id))
			.ToList();
		// New rows make WPF recreate every card, which drops keyboard focus and hover. Keep
		// the rows while the same devices are listed in the same order and update them in
		// place, as SwiftUI keeps a card per device id on macOS.
		if (!listed.SequenceEqual(_rowSource))
		{
			_rowSource = listed;
			if (listed.Select(device => device.Id).SequenceEqual(Rows.Select(row => row.Id)))
			{
				foreach (var (row, device) in Rows.Zip(listed)) row.Update(device, Presentation.Status(device));
			}
			else
			{
				Rows = listed.Select(device => new DeviceRow(device, Presentation.Status(device))).ToList();
			}
		}
		// Kept in place while the same hosts are listed, so Try again keeps focus while it runs.
		if (!_state.UnverifiedDevices.SequenceEqual(_unverifiedSource) || !ReferenceEquals(_state.RetryingHosts, _retryingSource))
		{
			_unverifiedSource = _state.UnverifiedDevices;
			_retryingSource = _state.RetryingHosts;
			if (_unverifiedSource.Select(device => device.Host).SequenceEqual(UnverifiedRows.Select(row => row.Host)))
			{
				foreach (var (row, device) in UnverifiedRows.Zip(_unverifiedSource))
				{
					row.Update(device, _retryingSource.Contains(device.Host));
				}
			}
			else
			{
				UnverifiedRows = _unverifiedSource
					.Select(device => new UnverifiedRow(device, _retryingSource.Contains(device.Host)))
					.ToList();
			}
		}
		if (!_state.UpdateRequiredDevices.SequenceEqual(_updateSource))
		{
			_updateSource = _state.UpdateRequiredDevices;
			UpdateRows = _updateSource.Select(device => new UpdateRequiredRow(device)).ToList();
		}
		// These rows only show in the full list, so any of them rules out the welcome card.
		SingleUnsaved = Rows.Count == 1 && UnverifiedRows.Count == 0 && UpdateRows.Count == 0 && !Rows[0].Device.Saved
			? Rows[0]
			: null;
		var count = Rows.Count + UnverifiedRows.Count + UpdateRows.Count;
		Subtitle = _state.InitialDiscoveryInProgress || _state.Scanning
			? "Searching for devices…"
			: count == 0
				? "No Umbrel devices found on your network"
				: SingleUnsaved is not null
					? SingleUnsaved.Device.Onboarded == true ? "Your device is ready to connect" : "Your device is ready for setup"
					: count == 1 ? "Found 1 device on your network" : $"Found {count} devices on your network";
		OnPropertyChanged(nameof(ShowRefresh));
		OnPropertyChanged(nameof(IsEmpty));
		OnPropertyChanged(nameof(Searching));
		OnPropertyChanged(nameof(Scanning));
		OnPropertyChanged(nameof(ShowFooter));
		OnPropertyChanged(nameof(ScanButtonText));
		OnPropertyChanged(nameof(WelcomeButtonText));
	}
}
