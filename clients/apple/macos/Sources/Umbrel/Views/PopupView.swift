import SwiftUI

// Popup content: list of devices, or the detail view for the selected one
struct PopupView: View {
	@Environment(AppState.self) private var state
	@Environment(UpdateController.self) private var updateController
	@State private var selectedId: String?
	@State private var showingAddressConnection = false
	@State private var autoSelected = false

	// Everything worth showing: saved devices (even offline) and discovered ones
	private var listedDevices: [Device] {
		state.devices.filter {
			($0.saved || $0.online) && !state.isUnsavedManualOnlyDevice($0.id)
		}
	}

	private var savedIds: [String] {
		listedDevices.filter(\.saved).map(\.id)
	}

	var body: some View {
		VStack(spacing: 0) {
			page
			// Every page, because a single saved Umbrel opens straight to its own page
			// and its owner may never see the device list
			if updateController.availableUpdateVersion != nil {
				UpdateAvailableRow {
					updateController.checkForUpdates(nil)
				}
			}
		}
		.frame(width: 420)
		// With exactly one saved device, skip the list and open its detail view.
		// Only once per app run, so navigating back to the list sticks.
		.onChange(of: savedIds, initial: true) {
			guard !autoSelected, selectedId == nil, savedIds.count == 1 else { return }
			autoSelected = true
			selectedId = savedIds[0]
		}
		.alert(
			item: Binding(
				get: { state.configStorageIssue },
				set: { if $0 == nil { state.dismissConfigStorageIssue() } }
			)
		) { issue in
			Alert(
				title: Text(issue.title),
				message: Text(issue.localizedDescription),
				dismissButton: .default(Text("OK"))
			)
		}
	}

	private var page: some View {
		Group {
			if let selectedId, state.devices.contains(where: { $0.id == selectedId }) {
				DeviceDetailView(deviceId: selectedId) {
					self.selectedId = nil
					state.discardUnsavedManualDevice(selectedId)
				}
			} else if showingAddressConnection {
				AddressConnectionView {
					showingAddressConnection = false
				} onSelect: { deviceId in
					showingAddressConnection = false
					selectedId = deviceId
				}
			} else {
				DeviceListView(
					devices: listedDevices,
					unverifiedDevices: state.unverifiedDevices,
					updateRequiredDevices: state.updateRequiredDevices
				) { deviceId in
					selectedId = deviceId
				} onConnectByAddress: {
					showingAddressConnection = true
				}
			}
		}
	}
}

// A standing reminder for an update the user put off: the update window appears on
// its own once per version, and this opens it again
private struct UpdateAvailableRow: View {
	let action: () -> Void

	var body: some View {
		Button(action: action) {
			HStack(spacing: 6) {
				// White rather than blue, which device cards use for "ready" statuses
				Circle()
					.fill(.white)
					.frame(width: 6, height: 6)
					.shadow(color: .white.opacity(0.8), radius: 3)
				HStack(spacing: 2) {
					Text("Update available").foregroundStyle(.primary)
					Image(systemName: "chevron.right")
						.font(.system(size: 9, weight: .semibold))
				}
			}
			.font(.system(size: 11, weight: .medium))
			.foregroundStyle(.secondary)
			.contentShape(Rectangle())
		}
		.buttonStyle(.plain)
		.frame(maxWidth: .infinity, alignment: .leading)
		.padding(.horizontal, 24)
		.padding(.bottom, 16)
	}
}
