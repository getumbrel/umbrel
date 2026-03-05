// This must be in it's own file otherwise the frontend tries to import
// loads of stuff from the backend and blows up.

// Export the router type for use in clients in other packages
export type {AppRouter} from './index.js'

// RPCs that MUST use HTTP (cookie/header semantics). Clients use this list for split-link routing.
export const httpOnlyPaths = [
	// sets cookie
	'user.login',
	// reads Authorization header
	'user.isLoggedIn',
	// renews cookie
	'user.renewToken',
	// clears cookie
	'user.logout',
	// system.status doesn't use cookies/headers, but the UI polls it across restarts to detect when umbreld is back online; we force HTTP to avoid WS reconnect handshake
	'system.status',
] as const
