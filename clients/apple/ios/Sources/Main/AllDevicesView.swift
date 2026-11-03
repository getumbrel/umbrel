import SwiftUI
import UmbrelKit

// The device switcher: a black screen with the Umbrel mark, a "+"
// to add another device, and a card per saved device showing that device's wallpaper,
// render, name and current status. Tapping a card opens that device.
struct AllDevicesView: View {
	let devices: [SavedDevice]
	@Binding var connectionSnapshots: [String: DeviceConnectionSnapshot]
	var onConfigStorageIssue: (Config.StorageIssue) -> Void
	var onSelect: (SavedDevice) -> Void
	var onAdd: () -> Void

	var body: some View {
		ZStack(alignment: .top) {
			Color.black.ignoresSafeArea()

			ScrollView(showsIndicators: false) {
				VStack(spacing: 12) {
					ForEach(devices, id: \.id) { device in
						Button { onSelect(device) } label: {
							DeviceCard(
								device: device,
								signedIn: isSignedIn(device),
								connectionSnapshot: connectionSnapshot(for: device.id),
								onConfigStorageIssue: onConfigStorageIssue
							)
						}
						.buttonStyle(.plain)
					}
				}
				.padding(.horizontal, Theme.contentInset)
				.padding(.top, 56)
				.padding(.bottom, 32)
			}

			LinearGradient(colors: [.black, .clear], startPoint: .top, endPoint: .bottom)
				.frame(height: 120)
				.frame(maxWidth: .infinity)
				.ignoresSafeArea()
				.allowsHitTesting(false)

				header
		}
	}

	private var header: some View {
		HStack {
			Image("UmbrelMark")
				.resizable()
				.scaledToFit()
				.frame(height: 19)
				.foregroundStyle(.white)
			Spacer()
			CircleIconButton(system: "plus", accessibilityLabel: "Add Umbrel", action: onAdd)
		}
		.padding(.leading, 28)
		.padding(.trailing, Theme.contentInset)
	}

	private func isSignedIn(_ device: SavedDevice) -> Bool {
		switch Keychain.readSession(deviceId: device.id) {
		case .found, .unavailable: true
		case .missing, .invalid: false
		}
	}

	private func connectionSnapshot(for deviceId: String) -> Binding<DeviceConnectionSnapshot> {
		Binding(
			get: { connectionSnapshots[deviceId] ?? .unverified },
			set: { connectionSnapshots[deviceId] = $0 }
		)
	}
}

// One device row: the device's wallpaper (dimmed) behind its render, name and status.
private struct DeviceCard: View {
	let device: SavedDevice
	let signedIn: Bool
	let onConfigStorageIssue: (Config.StorageIssue) -> Void
	@Binding private var connectionSnapshot: DeviceConnectionSnapshot

	@Environment(\.scenePhase) private var scenePhase
	@Environment(\.dynamicTypeSize) private var dynamicTypeSize
	@State private var userName: String?
	@State private var wallpaper: UIImage?
	@State private var sessionAvailable: Bool
	@State private var showsConnectionProgress = false

	init(
		device: SavedDevice,
		signedIn: Bool,
		connectionSnapshot: Binding<DeviceConnectionSnapshot>,
		onConfigStorageIssue: @escaping (Config.StorageIssue) -> Void
	) {
		self.device = device
		self.signedIn = signedIn
		self.onConfigStorageIssue = onConfigStorageIssue
		_connectionSnapshot = connectionSnapshot
		_userName = State(initialValue: device.userName)
		_sessionAvailable = State(initialValue: signedIn)
	}

	var body: some View {
		HStack(spacing: 16) {
			UmbrelDeviceRender(model: device.model, placement: .deviceRow)
				.shadow(color: .black.opacity(0.16), radius: 8, y: 8)

			VStack(alignment: .leading, spacing: 4) {
				let owner = Text(userName.map { "\($0)\u{2019}s " } ?? "").foregroundStyle(.white)
				let model = Text(device.model ?? device.name).foregroundStyle(.white.opacity(0.7))
				Text("\(owner)\(model)")
					.font(.title3.weight(.semibold))
					.lineLimit(dynamicTypeSize.isAccessibilitySize ? 2 : 1)
					.truncationMode(.tail)

				statusLine
			}
			Spacer(minLength: 0)
		}
		.padding(.horizontal, 24)
		.frame(maxWidth: .infinity, minHeight: 147, alignment: .leading)
		.background(cardBackground)
		.clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
		// The wallpaper's scaledToFill overflows the card; clipShape trims the drawing
		// but not the hit area, so without this the tap target is wallpaper-sized
		.contentShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
		.glassGlint(in: RoundedRectangle(cornerRadius: 24, style: .continuous))
		.task(id: scenePhase) {
			guard scenePhase == .active else { return }
			// Restore the cached wallpaper first, even when offline.
			if let id = device.wallpaperId {
				if let cached = await WallpaperStore.shared.cachedCard(id: id) {
					withAnimation(.easeOut(duration: 0.2)) { wallpaper = cached }
				}
			}
			// Then refresh name + wallpaper from the device if it's reachable, and persist
			// them so this card still renders correctly next launch and offline.
			guard sessionAvailable else { return }
			guard !connectionSnapshot.isFresh() else { return }
			let sessionRead = Keychain.readSession(deviceId: device.id)
			guard let session = sessionRead.session else {
				switch sessionRead {
				case .missing, .invalid:
					sessionAvailable = false
				case .found, .unavailable:
					connectionSnapshot = DeviceConnectionSnapshot(
						state: .unavailable,
						checkedAt: Date()
					)
				}
				return
			}
			let target = device.nativeTarget
			guard let info = try? await Umbreld.user(target: target, session: session) else {
				// A 401 during the request can definitively remove the session. Re-read
				// instead of misreporting that signed-out state as an offline Umbrel.
				switch Keychain.readSession(deviceId: device.id) {
				case .missing, .invalid:
					sessionAvailable = false
				case .found, .unavailable:
					connectionSnapshot = DeviceConnectionSnapshot(
						state: .unavailable,
						checkedAt: Date()
					)
				}
				return
			}
			sessionAvailable = true
			connectionSnapshot = DeviceConnectionSnapshot(
				state: .connected,
				checkedAt: Date()
			)
			userName = info.name
			if let loaded = await WallpaperStore.shared.loadCard(
				id: info.wallpaper.id,
				target: target
			) {
				withAnimation(.easeOut(duration: 0.2)) { wallpaper = loaded }
			}
			let result = Config.load()
			if let issue = result.issue {
				onConfigStorageIssue(issue)
				return
			}
			var config = result.config
			do {
				try config.update(id: device.id) {
					$0.saveAccountProfile(
						accountId: info.userId,
						name: info.name,
						wallpaperId: info.wallpaper.id,
						wallpaperBrandColorHsl: info.wallpaper.brandColorHsl,
						role: info.role
					)
				}
			} catch {
				onConfigStorageIssue((error as? Config.StorageIssue) ?? .saveFailed)
			}
		}
		.task(id: sessionAvailable && connectionSnapshot.state == .unverified) {
			showsConnectionProgress = false
			guard sessionAvailable, connectionSnapshot.state == .unverified else { return }
			try? await Task.sleep(for: .milliseconds(400))
			guard !Task.isCancelled, sessionAvailable,
				connectionSnapshot.state == .unverified
			else { return }
			showsConnectionProgress = true
		}
		.onChange(of: signedIn) { _, signedIn in
			sessionAvailable = signedIn
		}
	}

	private var statusLine: some View {
		HStack(spacing: 4) {
			if !sessionAvailable {
				StatusDot(color: Theme.gray)
				Text("Signed out")
			} else if connectionSnapshot.state == .unverified {
				ProgressView()
					.controlSize(.small)
					.tint(.white.opacity(0.7))
					.opacity(showsConnectionProgress ? 1 : 0)
					.accessibilityLabel("Checking connection")
					.accessibilityHidden(!showsConnectionProgress)
			} else if connectionSnapshot.state == .connected {
				StatusDot(color: Theme.online)
				Text("Connected")
			} else {
				StatusDot(color: Theme.gray)
				Text("Offline")
			}
			// The host tells apart Umbrels that share an owner and model. It stays on the
			// status line and gives way to the status by truncating in the middle.
			Group {
				Text("\u{00B7}")
				Text(device.host)
					.truncationMode(.middle)
					.layoutPriority(-1)
			}
			.foregroundStyle(.white.opacity(0.7))
		}
		.lineLimit(1)
		.frame(minHeight: 16, alignment: .leading)
		.font(.footnote.weight(.medium))
		.foregroundStyle(.white)
	}

	private var cardBackground: some View {
		return ZStack {
			Color(hex: 0x1C1C1C)
			if let wallpaper {
				Image(uiImage: wallpaper)
					.resizable()
					.scaledToFill()
					.transition(.opacity)
			}
			Color.black.opacity(0.2)
		}
		.clipped()
	}
}
