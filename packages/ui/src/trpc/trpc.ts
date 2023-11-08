import {createTRPCProxyClient, createTRPCReact, httpBatchLink, loggerLink} from '@trpc/react-query'
import {inferRouterInputs, inferRouterOutputs} from '@trpc/server'

import type {AppRouter} from '../../../../packages/umbreld/source/modules/server/trpc/index'

export type {Category} from '../../../../packages/umbreld/source/modules/apps/schema'

export {categories} from '../../../../packages/umbreld/source/modules/apps/data'

// TODO: Getting jwt from `localStorage` like this means auth flow require a page refresh
const jwt = localStorage.getItem('jwt')
export const links = [
	loggerLink({
		enabled: () => true,
	}),
	httpBatchLink({
		url: `http://${location.hostname}:3001/trpc`,
		headers: async () => ({
			Authorization: `Bearer ${jwt}`,
		}),
	}),
]

// React client
export const trpcReact = createTRPCReact<AppRouter>()

// Vanilla client
export const trpcClient = createTRPCProxyClient<AppRouter>({links})

// Types ----------------------------

export type RouterInput = inferRouterInputs<AppRouter>
export type RouterOutput = inferRouterOutputs<AppRouter>

export type RegistryApp = NonNullable<RouterOutput['appStore']['registry'][number]>['apps'][number]
