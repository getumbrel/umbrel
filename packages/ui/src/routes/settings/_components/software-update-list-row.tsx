import {RiArrowUpCircleFill, RiCheckboxCircleFill, RiRefreshLine} from 'react-icons/ri'

import {CoverMessage, CoverMessageParagraph} from '@/components/ui/cover-message'
import {Icon} from '@/components/ui/icon'
import {Loading} from '@/components/ui/loading'
import {useSoftwareUpdate} from '@/hooks/use-software-update'
import {Button} from '@/shadcn-components/ui/button'
import {t} from '@/utils/i18n'

import {ListRow} from './list-row'

export function SoftwareUpdateListRow({isActive}: {isActive: boolean}) {
	const {state, currentVersion, latestVersion, upgrade, checkLatest} = useSoftwareUpdate()

	if (state === 'upgrading') {
		return (
			<CoverMessage>
				<Loading>{t('software-update.updating-to', {version: latestVersion})}</Loading>
				<CoverMessageParagraph>{t('do-not-while', {while: t('update')})}</CoverMessageParagraph>
			</CoverMessage>
		)
	}

	if (state === 'update-available') {
		return (
			<ListRow
				isActive={isActive}
				title={`umbrelOS ${currentVersion}`}
				description={
					<span className='flex items-center gap-1'>
						<Icon component={RiArrowUpCircleFill} className='text-brand' />
						{t('software-update.new-version', {version: latestVersion})}
					</span>
				}
				isLabel
			>
				<Button variant='primary' onClick={upgrade}>
					<Icon component={RiRefreshLine} />
					{t('software-update.update-now')}
				</Button>
			</ListRow>
		)
	}

	return (
		<ListRow
			isActive={isActive}
			title={`umbrelOS ${currentVersion}`}
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
			isLabel={state !== 'at-latest'}
		>
			{state !== 'at-latest' && (
				<Button onClick={checkLatest}>
					<Icon component={RiRefreshLine} className={state === 'checking' ? 'animate-spin' : undefined} />
					{state === 'checking' ? t('software-update.checking') : t('software-update.check-short')}
				</Button>
			)}
		</ListRow>
	)
}
