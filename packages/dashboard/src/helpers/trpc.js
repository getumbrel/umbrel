import {createTRPCProxyClient, httpBatchLink} from '@trpc/client'

export const trpc = createTRPCProxyClient({
	links: [
		httpBatchLink({
			url: `${window.location.protocol}//${window.location.hostname}:81/trpc`,
			headers: async () => ({
				Authorization: `Bearer ${window.localStorage.getItem('jwt')}`,
			}),
		}),
	],
})
