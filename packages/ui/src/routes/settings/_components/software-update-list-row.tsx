import {RiArrowUpCircleFill, RiCheckboxCircleFill, RiRefreshLine} from 'react-icons/ri'

import {CoverMessage, CoverMessageParagraph} from '@/components/ui/cover-message'
import {Icon} from '@/components/ui/icon'
import {Loading} from '@/components/ui/loading'
import {useSoftwareUpdate} from '@/hooks/use-software-update'
import {Button} from '@/shadcn-components/ui/button'

import {ListRow} from './list-row'

export function SoftwareUpdateListRow() {
	const {state, currentVersion, latestVersion, upgrade, checkLatest} = useSoftwareUpdate()

	if (state === 'upgrading') {
		return (
			<CoverMessage>
				<Loading>Updating to umbrelOS {latestVersion}</Loading>
				<CoverMessageParagraph>
					Please do not refresh this page or turn off your Umbrel while the update is in progress
				</CoverMessageParagraph>
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
			isLabel={state !== 'at-latest'}
		>
			{state !== 'at-latest' && (
				<Button onClick={checkLatest}>
					<Icon component={RiRefreshLine} className={state === 'checking' ? 'animate-spin' : undefined} />
					{state === 'checking' ? 'Checking for updates...' : 'Check for updates'}
				</Button>
			)}
		</ListRow>
	)
}
