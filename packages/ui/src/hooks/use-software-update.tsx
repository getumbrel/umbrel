import {useState} from 'react'

import {toast} from '@/components/ui/toast'
import {trpcReact} from '@/trpc/trpc'
import {sleep} from '@/utils/misc'

export type UpdateState = 'initial' | 'checking' | 'at-latest' | 'update-available' | 'upgrading'

export function useSoftwareUpdate() {
	const [state, setState] = useState<UpdateState>('initial')
	const [latestVersion, setLatestVersion] = useState('')

	const ctx = trpcReact.useContext()
	const osVersionQ = trpcReact.system.osVersion.useQuery()

	const currentVersion = osVersionQ.data ?? 'Unknown'

	const checkLatest = async () => {
		setState('checking')
		try {
			const latestVersion = await ctx.system.getLatestVersion.fetch()
			if (!latestVersion) {
				throw new Error('Failed to check for updates')
			}
			setLatestVersion(latestVersion)
			if (latestVersion !== currentVersion) {
				setState('update-available')
			} else {
				setState('at-latest')
			}
		} catch (error) {
			setState('initial')
			toast.error('Failed to check for updates')
		}
	}

	const upgrade = async () => {
		setState('upgrading')
		await sleep(1000)
		// TODO: actually upgrade
		setState('at-latest')
		toast.success(`Successfully upgraded to umbrelOS ${latestVersion}`)
		// toast.error('Failed to upgrade')
	}

	return {
		state,
		currentVersion,
		latestVersion,
		checkLatest,
		upgrade,
	}
}
