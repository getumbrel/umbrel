import Foundation
import UmbrelKit

// The single device snapshot the UI renders from. AppState rebuilds these by merging
// mDNS discovery results, saved config, in-memory auth, and share mount state.
struct Device: Identifiable, Equatable {
	let id: String
	var name: String // mDNS service name (usually the hostname)
	var host: String // mDNS hostname, e.g. "umbrel.local"
	var connectionHost: String? // endpoint selected for native traffic while connected
	var addresses: [String] // IPv4 addresses
	var model: String? // TXT `device` record, e.g. "Umbrel Home (2025)"
	var userName: String?
	var reachability: DeviceReachability
	var saved: Bool
	var connection: ConnectionState
	var shares: [Share]
	var onboarded: Bool? // from TXT hint or identity probe; nil when unknown (offline)
	var dashboardUsesHTTPS: Bool // browser links only; independent of native transport

	var online: Bool { reachability == .online }

	var displayModel: String { model ?? name }

	// Includes the user's name when available (e.g. "Patrick's Umbrel Home (2025)").
	var displayName: String { userName.map { "\($0)\u{2019}s \(displayModel)" } ?? displayModel }
}

enum DeviceReachability: Equatable {
	case unverified
	case online
	case offline
}

enum ConnectionState: Equatable {
	case notAuthenticated
	case connecting
	case connected
	case disconnecting
	case expired // Native grant rejected (401): user must re-enter their password
}

struct Share: Identifiable, Equatable {
	let name: String
	let path: String
	let sharename: String // client-facing SMB share name, e.g. "Patrick's Umbrel"
	var mountPath: String? // actual mount path, e.g. /Volumes/Documents-1 on name conflicts
	var status: MountStatus

	var id: String { sharename }
}

enum MountStatus: Equatable {
	case mounting
	case mounted
	case unmounting
	case unmounted
}
