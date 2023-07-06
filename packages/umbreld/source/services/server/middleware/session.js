import expressSession from 'express-session'
import fileStoreInit from 'session-file-store'
import ms from 'ms'

import randomToken from '../../../utilities/random-token.js'

const FileStore = fileStoreInit(expressSession)

const msToSeconds = (ms) => ms / 1000

const session = ({sessionsPath, sessionSecret}) => {
	return expressSession({
		// Avoid collisions with other apps on the same hostname
		name: 'umbrel-session',
		// Read secret from data directory
		secret: sessionSecret,
		// 128 bit hex string ids
		genid: () => randomToken(128),
		// Persist sessions between restarts by storing in the data directory
		store: new FileStore({
			path: sessionsPath,
			// Clean up expired sessions every hour
			reapInterval: msToSeconds(ms('1 hour')),
			// Supress logs
			logFn() {},
		}),
		// Don't save session data for unauthenticated users
		saveUninitialized: false,
		// Don't save the session data on every request, only when it's been modified
		resave: false,
		// Don't set the cookie on every response
		rolling: false,
		// Cookie properties
		cookie: {
			// Hide cookie from browser JavaScript context
			httpOnly: true,
			// Expire after a month
			maxAge: ms('30 days'),
			// Set cookie for root path
			path: '/',
			// Don't send cookies in requests from external origin
			sameSite: 'strict',
			// Send cookies over plaintext connections (required for local access)
			// TODO: Research into if users auth at https://public-umbrel-instance.com
			// and are then tricked into visiting the http:// variant do they leak the
			// existing https:// cookie over the new plaintext connection?
			secure: false,
		},
	})
}

export default session
