import {RiArrowUpCircleFill, RiCheckboxCircleFill, RiRefreshLine} from 'react-icons/ri'

import {Icon} from '@/components/ui/icon'
import {LOADING_DASH} from '@/constants'
import {useSoftwareUpdate} from '@/hooks/use-software-update'
import {useGlobalSystemState} from '@/providers/global-system-state'
import {Button} from '@/shadcn-components/ui/button'
import {t} from '@/utils/i18n'

import {ListRow} from './list-row'

export function SoftwareUpdateListRow({isActive}: {isActive: boolean}) {
	const {update} = useGlobalSystemState()
	const {state, currentVersion, latestVersion, checkLatest} = useSoftwareUpdate()

	if (state === 'update-available') {
		return (
			<ListRow
				isActive={isActive}
				title={`umbrelOS ${currentVersion || LOADING_DASH}`}
				description={
					<span className='flex items-center gap-1'>
						<Icon component={RiArrowUpCircleFill} className='text-brand' />
						{t('software-update.new-version', {version: latestVersion || LOADING_DASH})}
					</span>
				}
			>
				<Button variant='primary' onClick={update}>
					<Icon component={RiRefreshLine} />
					{t('software-update.update-now')}
				</Button>
			</ListRow>
		)
	}

	return (
		<ListRow
			isActive={isActive}
			title={`umbrelOS ${currentVersion || LOADING_DASH}`}
			description={
				<span className='flex items-center gap-1'>
					{state === 'at-latest' ? (
						<>
							<Icon component={RiCheckboxCircleFill} className='text-success' />
							{t('software-update.on-latest')}
						</>
					) : (
						<>
							{/* Invisible icon to prevent layout shift */}
							{t('check-for-latest-version')}
							<Icon component={RiArrowUpCircleFill} className='invisible' />
						</>
					)}
				</span>
			}
		>
			{state !== 'at-latest' && (
				<Button onClick={checkLatest}>
					<Icon component={RiRefreshLine} className={state === 'checking' ? 'animate-spin' : undefined} />
					{state === 'checking' ? t('software-update.checking') : t('software-update.check')}
				</Button>
			)}
		</ListRow>
	)
}
