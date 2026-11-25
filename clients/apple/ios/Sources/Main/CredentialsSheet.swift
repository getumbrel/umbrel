import SwiftUI
import UIKit
import UmbrelKit
import UniformTypeIdentifiers

// Shown before the first open of an app that ships default sign-in credentials
// (umbrelOS web parity): the user copies them, then continues into the app.
// "Don't show this again" persists on the device via apps.hideCredentialsBeforeOpen,
// so the choice follows the user across clients.
struct CredentialsSheet: View {
	let app: Umbreld.AppSummary
	let onContinue: () -> Void

	@Environment(MainModel.self) private var model
	@Environment(\.dismiss) private var dismiss
	@Environment(\.dynamicTypeSize) private var dynamicTypeSize
	@State private var dontShowAgain = false

	var body: some View {
		NavigationStack {
			content
				.toolbar {
					DrawerCloseToolbarItem(action: { dismiss() })
				}
		}
		.presentationDetents([dynamicTypeSize.isAccessibilitySize ? .large : .medium])
		.presentationDragIndicator(.visible)
		.presentationBackground(Color(hex: 0x1C1C1E))
	}

	private var content: some View {
		VStack(spacing: 0) {
			AppIconView(url: app.iconURL, size: 64, corner: 16)

			Text(app.name ?? app.id)
				.font(.title3.weight(.semibold))
				.foregroundStyle(.white)
				.padding(.top, 16)

			Text("Sign in to this app with its default credentials.")
				.font(.subheadline)
				.foregroundStyle(Theme.gray)
				.padding(.top, 4)

			VStack(spacing: 0) {
				if let username = app.credentials?.defaultUsername {
					CredentialRow(label: "Username", value: username)
				}
				if app.credentials?.defaultUsername != nil, app.credentials?.defaultPassword != nil {
					Divider().overlay(.white.opacity(0.06))
				}
				if let password = app.credentials?.defaultPassword {
					CredentialRow(label: "Password", value: password)
				}
			}
			.background(Color(hex: 0x2C2C2E))
			.clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
			.padding(.top, 24)

			Toggle("Don't show this again", isOn: $dontShowAgain)
				.font(.subheadline)
				.foregroundStyle(Theme.gray)
				.tint(.green)
				.padding(.horizontal, 4)
				.padding(.top, 20)

			Spacer()

			Button {
				openApp()
			} label: {
				Text("Open \(app.name ?? "app")")
					.font(.headline)
					.foregroundStyle(.white)
					.frame(maxWidth: .infinity, minHeight: 48)
					.background(Color(hex: 0x6155F5), in: .capsule)
			}
			.buttonStyle(.plain)
			.padding(.bottom, 20)
		}
		.padding(.horizontal, 24)
	}

	private func openApp() {
		if dontShowAgain, let target = model.nativeTarget, let session = model.session {
			let appId = app.id
			Task { try? await Umbreld.hideCredentialsBeforeOpen(target: target, session: session, appId: appId) }
		}
		onContinue()
		dismiss()
	}
}

// Label + value with tap-to-copy (brief checkmark as feedback)
private struct CredentialRow: View {
	let label: String
	let value: String

	@State private var copied = false

	var body: some View {
		HStack(spacing: 12) {
			Text(label)
				.foregroundStyle(Theme.gray)
			Spacer()
			Text(value)
				.foregroundStyle(.white)
				.lineLimit(1)
				.truncationMode(.middle)
			Image(systemName: copied ? "checkmark" : "doc.on.doc")
				.font(.system(size: 14))
				.foregroundStyle(Theme.gray)
		}
		.font(.subheadline.weight(.medium))
		.padding(.horizontal, 16)
		.frame(minHeight: 52)
		.contentShape(Rectangle())
		.onTapGesture {
			CredentialPasteboard.copy(value)
			copied = true
			Task {
				try? await Task.sleep(for: .seconds(1.5))
				copied = false
			}
		}
	}
}

enum CredentialPasteboard {
	static let expirationInterval: TimeInterval = 2 * 60

	static func copy(_ value: String, now: Date = Date()) {
		UIPasteboard.general.setItems(
			[[UTType.utf8PlainText.identifier: value]],
			options: options(now: now)
		)
	}

	static func options(now: Date) -> [UIPasteboard.OptionsKey: Any] {
		[
			.localOnly: true,
			.expirationDate: now.addingTimeInterval(expirationInterval),
		]
	}
}
