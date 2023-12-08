import {useState} from 'react'
import {RiArrowUpCircleFill, RiCheckboxCircleFill, RiRefreshLine} from 'react-icons/ri'

import {CoverMessage} from '@/components/ui/cover-message'
import {Icon} from '@/components/ui/icon'
import {Loading} from '@/components/ui/loading'
import {toast} from '@/components/ui/toast'
import {Button} from '@/shadcn-components/ui/button'
import {trpcReact} from '@/trpc/trpc'
import {sleep} from '@/utils/misc'

import {ListRow} from './list-row'

type UpdateState = 'initial' | 'checking' | 'at-latest' | 'update-available' | 'upgrading'

export function SoftwareUpdateListRow() {
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

	if (state === 'upgrading') {
		return (
			<CoverMessage>
				<Loading>Updating to umbrelOS {latestVersion}</Loading>
			</CoverMessage>
		)
	}

	if (state === 'update-available') {
		return (
			<ListRow
				title={`umbrelOS ${currentVersion}`}
				description={
					<span className='flex items-center gap-1'>
						<Icon component={RiArrowUpCircleFill} className='text-brand' />
						New version {latestVersion} is available
					</span>
				}
				isLabel
			>
				<Button variant='primary' onClick={upgrade}>
					<Icon component={RiRefreshLine} />
					Update now
				</Button>
			</ListRow>
		)
	}

	return (
		<ListRow
			title={`umbrelOS ${currentVersion}`}
			description={
				<span className='flex items-center gap-1'>
					{state === 'at-latest' ? (
						<>
							<Icon component={RiCheckboxCircleFill} className='text-success' />
							You are on the latest version
						</>
					) : (
						<>
							{/* Invisible icon to prevent layout shift */}
							Check for latest version
							<Icon component={RiArrowUpCircleFill} className='invisible' />
						</>
					)}
				</span>
			}
			isLabel
		>
			{state !== 'at-latest' && (
				<Button onClick={checkLatest}>
					<Icon component={RiRefreshLine} className={state === 'checking' ? 'animate-spin' : undefined} />
					Check for updates
				</Button>
			)}
		</ListRow>
	)
}
