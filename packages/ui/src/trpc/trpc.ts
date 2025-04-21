import {
	createTRPCClient,
	createTRPCReact,
	createWSClient,
	httpLink,
	loggerLink,
	splitLink,
	TRPCClientErrorLike,
	wsLink,
} from '@trpc/react-query'
import {inferRouterInputs, inferRouterOutputs} from '@trpc/server'

import {JWT_LOCAL_STORAGE_KEY} from '@/modules/auth/shared'
import {IS_DEV} from '@/utils/misc'

import {httpPaths, type AppRouter} from '../../../umbreld/source/modules/server/trpc/common'

export const trpcUrl = `http://${location.hostname}:${location.port}/trpc`

// TODO: Getting jwt from `localStorage` like this means auth flow require a page refresh
const getJwt = () => localStorage.getItem(JWT_LOCAL_STORAGE_KEY)
export const links = [
	loggerLink({
		enabled: () => IS_DEV,
	}),
	splitLink({
		condition: (operation) => httpPaths.includes(operation.path as (typeof httpPaths)[number]),
		true: httpLink({
			url: trpcUrl,
			headers: () => ({Authorization: `Bearer ${getJwt()}`}),
		}),
		false: wsLink({
			client: createWSClient({url: () => `${trpcUrl}?token=${getJwt()}`}),
		}),
	}),
]

// React client
export const trpcReact = createTRPCReact<AppRouter>()

// Vanilla client
/** Use sparingly */
export const trpcClient = createTRPCClient<AppRouter>({links})

// Types ----------------------------

export type RouterInput = inferRouterInputs<AppRouter>
export type RouterOutput = inferRouterOutputs<AppRouter>
export type RouterError = TRPCClientErrorLike<AppRouter>

// ---

export type AppState = RouterOutput['apps']['state']['state']
export const appStates = [
	'unknown',
	'installing',
	'starting',
	'running',
	'stopping',
	'stopped',
	'restarting',
	'uninstalling',
	'updating',
	'ready',
] satisfies AppState[]

export const installStates = ['installing', 'uninstalling', 'updating'] satisfies AppState[]
export type InstallState = (typeof installStates)[number]
export const installedStates = ['running', 'stopped', 'ready', 'restarting', 'starting'] satisfies AppState[]
export type InstalledState = (typeof installedStates)[number]

export const progressStates = [
	// 'not-installed',
	'installing',
	'starting',
	'running',
	'stopping',
	'restarting',
	'uninstalling',
	'updating',
] satisfies AppState[]

export const progressBarStates = ['installing', 'updating'] satisfies AppState[]

// `loading` means the frontend is currently fetching the state from the backend
export type AppStateOrLoading = 'loading' | AppState

// Omitting `active` because we get the connection status from `WifiStatus` since it's more detailed and
// don't wanna get confused on the frontend with two different ways of getting the connection status
export type WifiNetwork = Omit<RouterOutput['wifi']['networks'][number], 'active'>
export type WifiStatus = Exclude<RouterOutput['wifi']['connected'], undefined>['status']
// `loading` is not returned by the backend, but is used in the frontend
export type WifiStatusUi = WifiStatus | 'loading'

// ---

/**
 * App in the registry as returned by the backend.
 */
export type RegistryApp = RouterOutput['appStore']['registry'][number]['apps'][number]

/**
 * Installed app as returned by the backend, no error.
 */
export type UserApp = Exclude<RouterOutput['apps']['list'][number], {error: string}>

/**
 * Installed app as returned by the backend, with error.
 */
export type UserAppError = Extract<RouterOutput['apps']['list'][number], {error: string}>
