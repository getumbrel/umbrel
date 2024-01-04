import {Portal} from '@radix-ui/react-portal'
import {ReactNode} from 'react'
import {TbArrowLeft, TbComet} from 'react-icons/tb'
import {useNavigate} from 'react-router-dom'
import {useTimeout} from 'react-use'

import {AppIcon} from '@/components/app-icon'
import {InstallButton} from '@/components/install-button'
import {DialogCloseButton} from '@/components/ui/dialog-close-button'
import {SHEET_HEADER_ID} from '@/constants'
import {useDemoInstallProgress} from '@/hooks/use-demo-progress'
import {Badge} from '@/shadcn-components/ui/badge'
import {RegistryApp} from '@/trpc/trpc'
import {portToUrl} from '@/utils/misc'
import {trackAppOpen} from '@/utils/track-app-open'

export const TopHeader = ({app, childrenRight}: {app: RegistryApp; childrenRight: ReactNode}) => {
	// Make sure header portal is mounted before showing it (render on the next tick)
	const showPortal = useTimeout(0)

	return (
		<>
			{showPortal && (
				<Portal
					container={document.getElementById(SHEET_HEADER_ID)}
					className='flex h-full w-full items-center gap-2.5'
				>
					<BackButton />
					<div className='flex flex-1 items-center gap-2.5'>
						<AppIcon src={app.icon} className='w-[32px] rounded-8' />
						<span className='truncate text-16 font-semibold -tracking-4 md:text-19'>{app.name}</span>
					</div>
					{childrenRight}
					<DialogCloseButton />
				</Portal>
			)}

			<div className='space-y-5'>
				{/*
				Tricky to get good behavior for this:
				- Naturally, we want to just go back to the previous page
				- However, when coming from home page, we want to go back to the app store
				- After clicking related apps, it's not clear what the back button should do
				*/}
				<BackButton />

				<div data-testid='app-top' className='flex flex-row items-center gap-5'>
					<AppIcon src={app.icon} className='w-[50px] rounded-12 md:w-[100px] md:rounded-20' />
					<div className='flex flex-col items-start gap-1 py-1 md:gap-2'>
						{app.optimizedForUmbrelHome && (
							<Badge variant='outline' icon={TbComet}>
								Optimized for Umbrel Home
							</Badge>
						)}
						<h1 className='text-16 font-semibold leading-inter-trimmed md:text-24'>{app.name}</h1>
						<p className='text-12 leading-tight opacity-50 md:text-16'>{app.tagline}</p>
						<div className='flex-1' />
						<div className='text-12 delay-100 animate-in fade-in slide-in-from-right-2 fill-mode-both md:text-13'>
							{app.developer}
						</div>
					</div>
					<div className='flex-1' />
					{childrenRight}
				</div>
			</div>
		</>
	)
}

function BackButton() {
	const navigate = useNavigate()

	return (
		<button onClick={() => navigate(-1)}>
			<TbArrowLeft className='h-5 w-5' />
		</button>
	)
}

export const TopHeaderWithDummyInstall = ({app}: {app: RegistryApp}) => {
	const {progress, state, install} = useDemoInstallProgress()

	return (
		<TopHeader
			app={app}
			childrenRight={
				<div className='flex items-center gap-5'>
					<InstallButton
						installSize='XGB'
						progress={progress}
						state={state}
						onInstallClick={install}
						onOpenClick={() => {
							trackAppOpen(app.id)
							window.open(portToUrl(app.port), '_blank')?.focus()
						}}
					/>
				</div>
			}
		/>
	)
}
