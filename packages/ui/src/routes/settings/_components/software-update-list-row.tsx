// TODO: Re-enable Trans and Link when whats-new content is updated
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import {Trans} from 'react-i18next/TransWithoutContext'
import {RiArrowUpCircleFill, RiCheckboxCircleFill, RiInformationLine, RiRefreshLine} from 'react-icons/ri'
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import {Link} from 'react-router-dom'

import {Button} from '@/components/ui/button'
import {Icon} from '@/components/ui/icon'
import {IconButtonLink} from '@/components/ui/icon-button-link'
import {LOADING_DASH} from '@/constants'
import {useSoftwareUpdate} from '@/hooks/use-software-update'
import {useLinkToDialog} from '@/utils/dialog'
import {t} from '@/utils/i18n'

import {ListRow} from './list-row'

export function SoftwareUpdateListRow({isActive}: {isActive: boolean}) {
	const {state, currentVersion, latestVersion, checkLatest} = useSoftwareUpdate()
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const linkToDialog = useLinkToDialog()

	if (state === 'update-available') {
		return (
			<ListRow
				isActive={isActive}
				title={currentVersion?.name || `umbrelOS ${LOADING_DASH}`}
				description={
					<span className='flex items-center gap-1 pb-3'>
						<Icon component={RiArrowUpCircleFill} className='text-brand' />
						{t('software-update.new-version', {name: latestVersion?.name || LOADING_DASH})}
					</span>
				}
			>
				<IconButtonLink icon={RiInformationLine} variant='primary' to='/settings/software-update/confirm'>
					{t('software-update.view')}
				</IconButtonLink>
			</ListRow>
		)
	}

	return (
		<ListRow
			isActive={isActive}
			title={currentVersion?.name || `umbrelOS ${LOADING_DASH}`}
			description={
				<span className='flex items-center gap-1 pb-3'>
					{state === 'at-latest' || state === 'checking' ? (
						<>
							<Icon component={RiCheckboxCircleFill} className='text-success' />
							{t('software-update.on-latest')}
							{/* TODO: Re-enable when whats-new content is updated */}
							{/* {' · '}
							<Trans
								i18nKey='software-update.see-whats-new'
								components={{
									linked: <Link to={linkToDialog('whats-new')} className='underline' />,
								}}
							/> */}
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
			<Button onClick={checkLatest}>
				<Icon component={RiRefreshLine} className={state === 'checking' ? 'animate-spin' : undefined} />
				{state === 'checking' ? t('software-update.checking') : t('software-update.check')}
			</Button>
		</ListRow>
	)
}
