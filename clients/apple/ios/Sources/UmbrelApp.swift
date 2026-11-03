import AVFoundation
import SwiftUI

@main
struct UmbrelApp: App {
	init() {
		PhotoBackupAppRunner.registerBackgroundTasks()
		// iOS 26 exposes AVPlayer through Observation, allowing the inline
		// transport control to follow playback state without a parallel model.
		AVPlayer.isObservationEnabled = true
	}

	var body: some Scene {
		WindowGroup {
			RootView()
				.preferredColorScheme(.dark)
		}
	}
}
