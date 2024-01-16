import {type CreateExpressContextOptions} from '@trpc/server/adapters/express'
import type Umbreld from '../../../index.js'

export const createContext = ({req, res}: CreateExpressContextOptions) => {
	const umbreld = req.app.get('umbreld') as Umbreld
	const logger = req.app.get('logger') as Umbreld['logger']
	const server = umbreld.server
	const user = umbreld.user
	const userApps = umbreld.userApps
	const appStore = umbreld.appStore
	const apps = umbreld.apps
	return {
		request: req,
		response: res,
		umbreld,
		server,
		user,
		userApps,
		appStore,
		apps,
		logger,
		dangerouslyBypassAuthentication: false,
	}
}

export type Context = ReturnType<typeof createContext>
