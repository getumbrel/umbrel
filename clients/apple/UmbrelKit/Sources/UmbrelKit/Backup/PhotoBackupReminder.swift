#if os(iOS)
import UserNotifications

// Backup should never stop without anyone knowing. iOS only runs the app's overnight
// backup while it's used, and decides itself when its own uploader runs. Every backup
// run, by the app or PhotoKit's extension, pushes this reminder a week out, so it only
// appears once nothing has backed up for that long. Opening the app backs up right away
// and keeps iOS's overnight runs coming.
public enum PhotoBackupReminder {
	private static let identifier = "photo-backup-reminder"
	private static let quietPeriod: TimeInterval = 7 * 24 * 60 * 60

	public static func push() {
		let center = UNUserNotificationCenter.current()
		center.getNotificationSettings { settings in
			guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else {
				return
			}
			let content = UNMutableNotificationContent()
			content.title = "Photo Backup"
			content.body = "It\u{2019}s been a week since your last backup. Open Umbrel to back up new photos and videos."
			// The same identifier replaces the pending reminder
			center.add(UNNotificationRequest(
				identifier: identifier,
				content: content,
				trigger: UNTimeIntervalNotificationTrigger(timeInterval: quietPeriod, repeats: false)
			))
			center.removeDeliveredNotifications(withIdentifiers: [identifier])
		}
	}

	public static func cancel() {
		let center = UNUserNotificationCenter.current()
		center.removePendingNotificationRequests(withIdentifiers: [identifier])
		center.removeDeliveredNotifications(withIdentifiers: [identifier])
	}

	// Asked once backup is on, when the reminder starts to matter
	public static func requestPermissionIfNeeded() async {
		let center = UNUserNotificationCenter.current()
		guard await center.notificationSettings().authorizationStatus == .notDetermined else { return }
		_ = try? await center.requestAuthorization(options: [.alert, .sound])
		push()
	}
}
#endif
