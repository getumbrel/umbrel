import Foundation

// Maps umbreld lifecycle strings into the visual language used by umbrelOS.
// Unknown future values degrade to the same unavailable treatment as `unknown`.
enum AppTilePresentation: Equatable {
	enum Activity: String, Equatable {
		case installing
		case starting
		case running
		case stopping
		case restarting
		case uninstalling
		case updating

		var label: String? {
			switch self {
			case .installing, .running: nil
			case .starting: "Starting\u{2026}"
			case .stopping: "Stopping\u{2026}"
			case .restarting: "Restarting\u{2026}"
			case .uninstalling: "Uninstalling\u{2026}"
			case .updating: "Updating\u{2026}"
			}
		}

		var accessibilityValue: String {
			switch self {
			case .installing: "Installing"
			case .starting: "Starting"
			case .running: "Running"
			case .stopping: "Stopping"
			case .restarting: "Restarting"
			case .uninstalling: "Uninstalling"
			case .updating: "Updating"
			}
		}

		var usesReportedProgress: Bool {
			self == .installing || self == .updating
		}
	}

	case available
	case stopped
	case unavailable
	case inProgress(Activity)

	init(state: String?) {
		switch state {
		case "ready": self = .available
		case "stopped": self = .stopped
		case "installing": self = .inProgress(.installing)
		case "starting": self = .inProgress(.starting)
		case "running": self = .inProgress(.running)
		case "stopping": self = .inProgress(.stopping)
		case "restarting": self = .inProgress(.restarting)
		case "uninstalling": self = .inProgress(.uninstalling)
		case "updating": self = .inProgress(.updating)
		case "unknown", nil: self = .unavailable
		default: self = .unavailable
		}
	}

	var dimsIcon: Bool { self != .available }

	var symbolName: String? {
		switch self {
		case .stopped: "pause.circle"
		case .unavailable: "exclamationmark.triangle"
		case .available, .inProgress: nil
		}
	}

	func label(default defaultLabel: String) -> String {
		switch self {
		case .unavailable: "Offline"
		case .inProgress(let activity): activity.label ?? defaultLabel
		case .available, .stopped: defaultLabel
		}
	}

	var accessibilityValue: String? {
		switch self {
		case .available: nil
		case .stopped: "Stopped"
		case .unavailable: "Offline"
		case .inProgress(let activity): activity.accessibilityValue
		}
	}

	func reportedProgress(_ progress: Double?) -> Double? {
		guard case .inProgress(let activity) = self,
			activity.usesReportedProgress,
			let progress,
			progress.isFinite
		else { return nil }
		return min(max(progress, 0), 100)
	}
}
