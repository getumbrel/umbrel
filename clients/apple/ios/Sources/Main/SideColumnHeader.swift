import SwiftUI

// The in-app browser's Close and More controls, the same way. The title bar stays
// wherever bars are horizontal; in the side column the page gets its height back.
struct BrowserSideColumnToolbar<MenuItems: View>: ViewModifier {
	var onClose: () -> Void
	var foreground: Color
	@Binding var isInSideColumn: Bool
	@ViewBuilder var menuItems: () -> MenuItems

	func body(content: Content) -> some View {
		if #available(iOS 27.1, *) {
			content.modifier(
				AvailableBrowserSideColumnToolbar(
					onClose: onClose,
					foreground: foreground,
					isInSideColumn: $isInSideColumn,
					menuItems: menuItems
				)
			)
		} else {
			content.toolbar(.hidden, for: .navigationBar)
		}
	}
}

@available(iOS 27.1, *)
private struct AvailableBrowserSideColumnToolbar<MenuItems: View>: ViewModifier {
	var onClose: () -> Void
	var foreground: Color
	@Binding var isInSideColumn: Bool
	@ViewBuilder var menuItems: () -> MenuItems

	@Environment(\.toolbarVerticalEdge) private var verticalEdge

	private var usesSideColumn: Bool { verticalEdge != nil }

	func body(content: Content) -> some View {
		content
			.toolbar {
				if usesSideColumn {
					ToolbarItem(placement: .cancellationAction) {
						Button(action: onClose) { Label("Close", systemImage: "xmark") }
							.tint(foreground)
					}
					ToolbarOverflowMenu { menuItems() }
				}
			}
			.toolbar(usesSideColumn ? .automatic : .hidden, for: .navigationBar)
			.onChange(of: usesSideColumn, initial: true) { _, inSideColumn in
				isInSideColumn = inSideColumn
			}
	}
}

// The tabs' header controls as system toolbar items: Back at the top leading corner and
// umbrelOS at the trailing one on iPhone, and in the side column on iPhone Duo, where
// only system bars can go.
struct TabHeaderToolbar: ViewModifier {
	let showsBack: Bool

	@Environment(MainModel.self) private var model
	@Environment(Browser.self) private var browser
	@State private var isOpeningBrowser = false
	@State private var isShowingBrowserUnavailable = false

	func body(content: Content) -> some View {
		content
			.toolbar {
				if showsBack {
					ToolbarItem(placement: .cancellationAction) {
						Button { model.onBack() } label: {
							Label("All Umbrels", systemImage: "chevron.left")
						}
						.tint(.white)
					}
				}
				ToolbarItem(placement: .primaryAction) {
					Button(action: openDashboard) {
						Label("Open umbrelOS", systemImage: "macwindow")
					}
					.tint(.white)
				}
			}
			.alert(model.unreachableTitle, isPresented: $isShowingBrowserUnavailable) {
				Button("OK", role: .cancel) {}
			} message: {
				Text(model.unreachableMessage)
			}
	}

	private func openDashboard() {
		guard !isOpeningBrowser else { return }
		isOpeningBrowser = true
		Task {
			defer { isOpeningBrowser = false }
			if await !browser.openUmbrel() {
				isShowingBrowserUnavailable = true
			}
		}
	}
}

// Reports whether the system is showing this screen's bars in the side column
struct SideColumnReader: ViewModifier {
	@Binding var isInSideColumn: Bool

	func body(content: Content) -> some View {
		if #available(iOS 27.1, *) {
			content.modifier(AvailableSideColumnReader(isInSideColumn: $isInSideColumn))
		} else {
			content
		}
	}
}

@available(iOS 27.1, *)
private struct AvailableSideColumnReader: ViewModifier {
	@Binding var isInSideColumn: Bool
	@Environment(\.toolbarVerticalEdge) private var verticalEdge

	func body(content: Content) -> some View {
		content.onChange(of: verticalEdge != nil, initial: true) { _, inSideColumn in
			isInSideColumn = inSideColumn
		}
	}
}

// umbrelOS's controls as system toolbar items, like the tabs': Close where the tabs'
// "Open umbrelOS" button is, with the page's options beside it, and a way back to the
// app that opened it with a link. On iPhone Duo they move into the side column.
struct UmbrelOSToolbar: ViewModifier {
	let isShown: Bool

	@Environment(Browser.self) private var browser

	func body(content: Content) -> some View {
		content
			.toolbar {
				// The bar itself stays up, so the page's safe area never changes and
				// umbrelOS doesn't shift while it fades in
				if isShown { items }
			}
			.toolbar(.visible, for: .navigationBar)
			.toolbarBackgroundVisibility(.hidden, for: .navigationBar)
			// umbrelOS sits on the app's own wallpaper, behind the navigation stack
			.containerBackground(.clear, for: .navigation)
	}

	@ToolbarContentBuilder private var items: some ToolbarContent {
		if let returnTarget = browser.returnTarget {
			ToolbarItem(placement: .cancellationAction) {
				Button { browser.returnToApp() } label: {
					Label(returnTarget.identity.name, systemImage: "chevron.left")
						// The name says where it goes, like the system's way back to the previous app
						.labelStyle(.titleAndIcon)
				}
				.accessibilityLabel("Back to \(returnTarget.identity.name)")
				.tint(.white)
			}
		}
		ToolbarItem(placement: .primaryAction) {
			Button { browser.closeUmbrel() } label: {
				Label("Close umbrelOS", systemImage: "xmark")
			}
			.tint(.white)
		}
		ToolbarItem(placement: .primaryAction) {
			Menu {
				Button("Reload", systemImage: "arrow.clockwise") { browser.umbrel?.reload() }
				Button("Open in Safari", systemImage: "safari") { openInSafari() }
			} label: {
				Label("More", systemImage: "ellipsis")
			}
			.tint(.white)
		}
	}

	private func openInSafari() {
		guard let page = browser.umbrel else { return }
		Task {
			guard let url = await browser.safariURL(for: page) else { return }
			await UIApplication.shared.open(url)
		}
	}
}
