import {Portal} from '@radix-ui/react-portal'
import {ReactNode} from 'react'
import {TbArrowLeft} from 'react-icons/tb'
import {useNavigate} from 'react-router-dom'
import {useTimeout} from 'react-use'

import {AppIcon} from '@/components/app-icon'
import {InstallButton} from '@/components/install-button'
import {CopyableField} from '@/components/ui/copyable-field'
import {SHEET_HEADER_ID} from '@/constants'
import {useDemoInstallProgress} from '@/hooks/use-demo-progress'
import {SheetClose} from '@/shadcn-components/ui/sheet'
import {Switch} from '@/shadcn-components/ui/switch'
import {RegistryApp} from '@/trpc/trpc'
import {portToUrl} from '@/utils/misc'
import {trackAppOpen} from '@/utils/track-app-open'
import {tw} from '@/utils/tw'

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
						<span className='text-19 font-semibold -tracking-4'>{app.name}</span>
					</div>
					{childrenRight}
					<SheetClose />
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

				<div className='flex flex-row items-center gap-5'>
					<AppIcon src={app.icon} className='w-[50px] rounded-12 md:w-[100px] md:rounded-20' />
					<div className='flex flex-col gap-1 py-1 md:gap-2'>
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

	// useEffect(() => {
	// 	if (state === 'installing') {
	// 		navigate({
	// 			search: '?dialog=default-credentials',
	// 		})
	// 	}
	// }, [state, navigate])

	const defaultUsername = 'umbrel'
	const defaultPassword = 'beef38f0a3f76510d8f24e259c5c3da8c4e245bd468afdd0eabfe86a4f7813e'

	return (
		<TopHeader
			app={app}
			childrenRight={
				<div className='flex items-center gap-5'>
					{state === 'installed' && (
						<>
							<div>
								<label className={textClass}>Default username</label>
								<CopyableField className='w-[120px]' narrow value={defaultUsername} />
							</div>
							<div>
								<label className={textClass}>Default password</label>
								<CopyableField narrow className='w-[120px]' value={defaultPassword} isPassword />
							</div>
							<label className='flex items-center gap-1.5 whitespace-nowrap text-15 font-medium'>
								<Switch />
								Auto-update
							</label>
						</>
					)}
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

const textClass = tw`text-12 font-normal leading-tight text-white/40 pr-6 whitespace-nowrap`
