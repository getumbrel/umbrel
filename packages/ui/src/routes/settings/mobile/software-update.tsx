import {CoverMessage, CoverMessageParagraph} from '@/components/ui/cover-message'
import {FadeInImg} from '@/components/ui/fade-in-img'
import {Loading} from '@/components/ui/loading'
import {UmbrelHeadTitle} from '@/components/umbrel-head-title'
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
import {t} from '@/utils/i18n'
import {tw} from '@/utils/tw'

export function SoftwareUpdateDrawer() {
	const title = t('software-update.title')
	const dialogProps = useSettingsDialogProps()

	const {state, currentVersion, latestVersion, upgrade, checkLatest} = useSoftwareUpdate()

	if (state === 'upgrading') {
		return (
			<CoverMessage>
				<UmbrelHeadTitle>{title}</UmbrelHeadTitle>
				<Loading>{t('software-update.updating-to', {version: latestVersion || LOADING_DASH})}</Loading>
				<CoverMessageParagraph>{t('software-update.updating-message')}</CoverMessageParagraph>
			</CoverMessage>
		)
	}

	return (
		<Drawer {...dialogProps}>
			<DrawerContent>
				<DrawerHeader>
					<UmbrelHeadTitle>{title}</UmbrelHeadTitle>
					<DrawerTitle>{title}</DrawerTitle>
					<DrawerDescription>{t('software-update.description-long')}</DrawerDescription>
				</DrawerHeader>
				<div className='flex flex-col items-center py-8'>
					<FadeInImg src='/figma-exports/umbrel-ios.png' className='h-[96px] w-[96px]' />
					<div className='mb-4' />
					<p className='text-15 -tracking-4'>umbrelOS {currentVersion || LOADING_DASH}</p>
					<p className='text-12 -tracking-2 opacity-50'>{t('software-update.current-running')}</p>
					{/* Make it look like a button, but non-interactive */}
				</div>
				<DrawerFooter>
					{state === 'at-latest' && (
						<>
							<div className={versionMessageClass}>{t('software-update.on-latest')}</div>
							<Button variant='primary' size='dialog' onClick={checkLatest}>
								{t('software-update.check-short')}
							</Button>
						</>
					)}
					{(state === 'initial' || state === 'checking') && (
						<>
							<div className={versionMessageClass}>&nbsp;{/* Spacer */}</div>
							<Button variant='primary' size='dialog' onClick={checkLatest} disabled={state === 'checking'}>
								{state === 'checking' ? t('software-update.checking') : t('software-update.check-short')}
							</Button>
						</>
					)}
					{state === 'update-available' && (
						<>
							<div className={versionMessageClass}>
								<div className='mr-2 inline-block h-1.5 w-1.5 -translate-y-px rounded-full bg-brand align-middle' />
								{t('software-update.new-version', {version: latestVersion})}
							</div>
							<Button variant='primary' size='dialog' onClick={upgrade}>
								{t('software-update.update-now')}
							</Button>
						</>
					)}
				</DrawerFooter>
			</DrawerContent>
		</Drawer>
	)
}

const versionMessageClass = tw`text-center text-14 font-semibold -tracking-2 py-4 leading-inter-trimmed`
