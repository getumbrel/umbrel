import {createTRPCProxyClient, createTRPCReact, httpBatchLink, loggerLink} from '@trpc/react-query'
import {inferRouterInputs, inferRouterOutputs} from '@trpc/server'

import type {AppRouter} from '../../../../packages/umbreld/source/modules/server/trpc/index'

export type {
	Category,
	AppState,
	AppManifest as RegistryApp,
	UserApp,
	Widget,
	WidgetType,
} from '../../../../packages/umbreld/source/modules/apps/schema'

export {categories} from '../../../../packages/umbreld/source/modules/apps/data'

export const trpcUrl = `http://${location.hostname}:3001/trpc`

// TODO: Getting jwt from `localStorage` like this means auth flow require a page refresh
const jwt = localStorage.getItem('jwt')
export const links = [
	loggerLink({
		enabled: () => true,
	}),
	httpBatchLink({
		url: trpcUrl,
		headers: async () => ({
			Authorization: `Bearer ${jwt}`,
		}),
	}),
]

// React client
export const trpcReact = createTRPCReact<AppRouter>()

// Vanilla client
/** Use sparingly */
export const trpcClient = createTRPCProxyClient<AppRouter>({links})

// Types ----------------------------

export type RouterInput = inferRouterInputs<AppRouter>
export type RouterOutput = inferRouterOutputs<AppRouter>

//

export type Device = RouterOutput['system']['deviceInfo']['device']
