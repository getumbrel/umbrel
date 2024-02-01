import {CoverMessage, CoverMessageParagraph} from '@/components/ui/cover-message'
import {FadeInImg} from '@/components/ui/fade-in-img'
import {Loading} from '@/components/ui/loading'
import {useSoftwareUpdate} from '@/hooks/use-software-update'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {Button} from '@/shadcn-components/ui/button'
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerFooter,
	DrawerHeader,
	DrawerTitle,
} from '@/shadcn-components/ui/drawer'
import {useDialogOpenProps} from '@/utils/dialog'
import {tw} from '@/utils/tw'

export function SoftwareUpdateDrawer() {
	const title = 'Software update'
	useUmbrelTitle(title)
	const dialogProps = useDialogOpenProps('software-update')

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

	return (
		<Drawer {...dialogProps}>
			<DrawerContent>
				<DrawerHeader>
					<DrawerTitle>{title}</DrawerTitle>
					<DrawerDescription>Check for latest software version and upgrade to it</DrawerDescription>
				</DrawerHeader>
				<div className='flex flex-col items-center py-8'>
					<FadeInImg src='/figma-exports/umbrel-ios.png' className='h-[96px] w-[96px]' />
					<div className='mb-4' />
					<p className='text-15 -tracking-4'>umbrelOS {currentVersion}</p>
					<p className='text-12 -tracking-2 opacity-50'>Currently running</p>
					{/* Make it look like a button, but non-interactive */}
				</div>
				<DrawerFooter>
					{state === 'at-latest' && (
						<>
							<div className={versionMessageClass}>You’re on the latest version</div>
							<Button variant='primary' size='dialog' onClick={checkLatest}>
								Check for updates
							</Button>
						</>
					)}
					{(state === 'initial' || state === 'checking') && (
						<>
							<div className={versionMessageClass}>&nbsp;{/* Spacer */}</div>
							<Button variant='primary' size='dialog' onClick={checkLatest} disabled={state === 'checking'}>
								{state === 'checking' ? 'Checking for updates...' : 'Check for updates'}
							</Button>
						</>
					)}
					{state === 'update-available' && (
						<>
							<div className={versionMessageClass}>
								<div className='mr-2 inline-block h-1.5 w-1.5 -translate-y-px rounded-full bg-brand align-middle' />
								New version {latestVersion} is available
							</div>
							<Button variant='primary' size='dialog' onClick={upgrade}>
								Update now
							</Button>
						</>
					)}
				</DrawerFooter>
			</DrawerContent>
		</Drawer>
	)
}

const versionMessageClass = tw`text-center text-14 font-semibold -tracking-2 py-4 leading-inter-trimmed`
