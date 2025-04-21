// This must be in it's own file otherwise the frontend tries to import
// loads of stuff from the backend and blows up.

// Export the router type for use in clients in other packages
export type {AppRouter} from './index.js'

// We define these here so all clients can depend on this to route
// RPCs that require HTTP over the HTTP transport via a split link.
// RPCs require HTTP if they need to be publically accessible
// (ws connection is authed during handshake) of if they need to interact
// with headers/cookies or other request/response stuff directly.
// Any RPC that has these requirements needs to be added to this list.
// This sucks but I don't see a better way to do it.
export const httpPaths = [
	// Public
	'migrationStatus',
	'system.online',
	'system.version',
	'system.status',
	'system.getFactoryResetStatus',
	// Public (and some get/set cookies)
	'user.register',
	'user.exists',
	'user.login',
	'user.isLoggedIn',
	'user.is2faEnabled',
	'user.wallpaper',
	'user.language',
	// Private but modify cookies
	'user.renewToken',
	'user.logout',
] as const
