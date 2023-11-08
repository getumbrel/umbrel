import {toast} from 'sonner'

import {trpcClient} from '@/trpc/trpc'

export function trackAppOpen(appId: string) {
	trpcClient.user.trackAppOpen.mutate({appId})
	toast(`${appId} opened`)
}
