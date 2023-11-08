import {toast} from 'sonner'

import {trpcReact} from '@/trpc/trpc'

// TODO: convert to non-React trpc function call
export function useTrackAppOpen() {
	const ctx = trpcReact.useContext()

	const trackOpenMut = trpcReact.user.trackAppOpen.useMutation({
		onSuccess: () => ctx.user.get.invalidate(),
	})

	const trackOpen = (appId: string) => {
		trackOpenMut.mutate({appId})
		toast(`${appId} opened`)
	}

	return {
		trackOpen,
	}
}
