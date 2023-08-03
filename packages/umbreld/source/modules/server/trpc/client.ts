import {createTRPCProxyClient, httpBatchLink} from '@trpc/client'
import fse from 'fs-extra'
import jwt from 'jsonwebtoken'

import type {AppRouter} from './index'

async function signJwt() {
	const secret = await fse.readFile(`./data/jwt/jwt.key`)
	const token = jwt.sign({cliClient: true}, secret, {expiresIn: 3600, algorithm: 'RS256'})
	return token
}

export const trpc = createTRPCProxyClient<AppRouter>({
	links: [
		httpBatchLink({
			url: 'http://localhost:3000/trpc',
			headers: async () => ({
				Authorization: `Bearer ${await signJwt()}`,
			}),
		}),
	],
})
