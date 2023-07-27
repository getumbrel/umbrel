import {type CreateExpressContextOptions} from '@trpc/server/adapters/express'
import type Umbreld from '../../index.js'

export const createContext = ({req, res}: CreateExpressContextOptions) => ({
	request: req,
	response: res,
	umbreld: req.app.get('umbreld') as Umbreld,
	dangerouslyBypassAuthentication: false,
})

export type Context = ReturnType<typeof createContext>
