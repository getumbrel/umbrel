import {shuffle} from 'remeda'

import {useAvailableApps} from '@/providers/available-apps'
import {trpcReact} from '@/trpc/trpc'

export function useDebugInstallRandomApps() {
	const apps = useAvailableApps()

	const installMut = trpcReact.apps.install.useMutation({
		onSuccess: () => {
			window.location.reload()
		},
	})

	const handleInstallABunch = () => {
		const toInstall = shuffle(apps?.apps ?? []).slice(0, 20) ?? []
		toInstall.map((app) => installMut.mutate({appId: app.id}))
	}

	return handleInstallABunch
}
