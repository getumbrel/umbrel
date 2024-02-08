import {trpcClient} from '@/trpc/trpc'

export function trackAppOpen(appId: string) {
	trpcClient.apps.trackOpen.mutate({appId})
}
