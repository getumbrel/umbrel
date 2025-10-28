import {Trans} from 'react-i18next/TransWithoutContext'
import {Link} from 'react-router-dom'

import {ButtonLink} from '@/components/ui/button-link'
import {FadeInImg} from '@/components/ui/fade-in-img'
import {LOADING_DASH} from '@/constants'
import {useSoftwareUpdate} from '@/hooks/use-software-update'
import {useSettingsDialogProps} from '@/routes/settings/_components/shared'
import {Button} from '@/shadcn-components/ui/button'
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerFooter,
	DrawerHeader,
	DrawerTitle,
} from '@/shadcn-components/ui/drawer'
import {useLinkToDialog} from '@/utils/dialog'
import {t} from '@/utils/i18n'
import {tw} from '@/utils/tw'

export function SoftwareUpdateDrawer() {
	const title = t('software-update.title')
	const dialogProps = useSettingsDialogProps()

	const {state, currentVersion, latestVersion, checkLatest} = useSoftwareUpdate()
	const linkToDialog = useLinkToDialog()

	return (
		<Drawer {...dialogProps}>
			<DrawerContent>
				<DrawerHeader>
					<DrawerTitle>{title}</DrawerTitle>
					<DrawerDescription>{t('check-for-latest-version')}</DrawerDescription>
				</DrawerHeader>
				<div className='flex flex-col items-center py-8'>
					<FadeInImg src='/figma-exports/umbrel-ios.png' className='h-[96px] w-[96px]' />
					<div className='mb-4' />
					<p className='text-12 -tracking-2 opacity-50'>{t('software-update.current-running')}</p>
					<p className='text-15 -tracking-4'>{currentVersion?.name || `umbrelOS ${LOADING_DASH}`}</p>
					<p className='text-12 -tracking-2 opacity-50'>
						<Trans
							i18nKey='software-update.see-whats-new'
							components={{
								linked: <Link to={linkToDialog('whats-new')} className='underline' />,
							}}
						/>
					</p>
					{/* Make it look like a button, but non-interactive */}
				</div>
				<DrawerFooter>
					{state === 'at-latest' && (
						<>
							<div className={versionMessageClass}>{t('software-update.on-latest')}</div>
							<Button variant='primary' size='dialog' onClick={checkLatest}>
								{t('software-update.check')}
							</Button>
						</>
					)}
					{(state === 'initial' || state === 'checking') && (
						<>
							<div className={versionMessageClass}>&nbsp;{/* Spacer */}</div>
							<Button variant='primary' size='dialog' onClick={checkLatest} disabled={state === 'checking'}>
								{state === 'checking' ? t('software-update.checking') : t('software-update.check')}
							</Button>
						</>
					)}
					{state === 'update-available' && (
						<>
							<div className={versionMessageClass}>
								<div className='mr-2 inline-block h-1.5 w-1.5 -translate-y-px rounded-full bg-brand align-middle' />
								{t('software-update.new-version', {name: latestVersion?.name})}
							</div>
							<ButtonLink variant='primary' size='dialog' to='/settings/software-update/confirm'>
								{t('software-update.view')}
							</ButtonLink>
						</>
					)}
				</DrawerFooter>
			</DrawerContent>
		</Drawer>
	)
}

const versionMessageClass = tw`text-center text-14 font-semibold -tracking-2 py-4 leading-inter-trimmed`
