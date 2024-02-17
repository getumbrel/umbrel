import {createTRPCProxyClient, createTRPCReact, httpBatchLink, loggerLink} from '@trpc/react-query'
import {inferRouterInputs, inferRouterOutputs} from '@trpc/server'

import {AppState} from '../../../../packages/umbreld/source/modules/apps/schema'
import type {AppManifest as RegistryApp} from '../../../../packages/umbreld/source/modules/apps/schema'
import type {AppRouter} from '../../../../packages/umbreld/source/modules/server/trpc/index'

export type {AppState, AppManifest as RegistryApp} from '../../../../packages/umbreld/source/modules/apps/schema'

export const trpcUrl = `http://${location.hostname}:${location.port}/trpc`

// TODO: Getting jwt from `localStorage` like this means auth flow require a page refresh
export const links = [
	loggerLink({
		enabled: () => true,
	}),
	httpBatchLink({
		url: trpcUrl,
		headers: async () => {
			const jwt = localStorage.getItem('jwt')
			return {
				Authorization: `Bearer ${jwt}`,
			}
		},
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

// ---

export type UserAppWithoutError = Exclude<RouterOutput['apps']['list'][number], {id: string; error: string}>

// ---

/**
 * App to store in yaml.
 * Stuff that can be retrieved from the app repository is not stored here.
 */
export type YamlApp = Pick<RegistryApp, 'id'> & {
	registryId: string
	showNotifications: boolean
	autoUpdate: boolean
	// Should always be true unless set to `false`
	// If no deterministic password, we don't show this
	showCredentialsBeforeOpen: boolean
}

/**
 * App to return to frontend after installing.
 * Usually pull stuff from app repository for names, etc
 */
export type UserApp = YamlApp &
	Pick<RegistryApp, 'name' | 'icon' | 'port' | 'path' | 'version' | 'torOnly'> & {
		credentials: {
			defaultUsername: string
			defaultPassword: string
		}
		hiddenService?: string
		// ---
		state: AppState
		// TODO: if state is installing, this should be 0-100, otherwise undefined
		/** From 0 to 100 */
		installProgress?: number
	}
