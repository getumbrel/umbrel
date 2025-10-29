// This must be in it's own file otherwise the frontend tries to import
// loads of stuff from the backend and blows up.

// Export the router type for use in clients in other packages
export type {AppRouter} from './index.js'

// RPCs that MUST use HTTP (cookies/headers or other request/response semantics).
// We define these here so all clients can depend on this to route these over HTTP
// transport via a split link.
// Any RPC that has these requirements needs to be added to this list.
// This sucks but I don't see a better way to do it.
export const httpOnlyPaths = [
	// sets cookie
	'user.login',
	// reads Authorization header
	'user.isLoggedIn',
	// renews cookie
	'user.renewToken',
	// clears cookie
	'user.logout',
] as const
