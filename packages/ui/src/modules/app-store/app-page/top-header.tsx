import {ReactNode, useEffect} from 'react'
import {TbArrowLeft} from 'react-icons/tb'
import {Link, To, useNavigate} from 'react-router-dom'

import {AppIcon} from '@/components/app-icon'
import {InstallButton} from '@/components/install-button'
import {useDemoInstallProgress} from '@/hooks/use-demo-progress'
import {RegistryApp} from '@/trpc/trpc'
import {portToUrl} from '@/utils/misc'
import {trackAppOpen} from '@/utils/track-app-open'

export const TopHeader = ({app, childrenRight}: {app: RegistryApp; childrenRight: ReactNode}) => {
	return (
		<div className='space-y-5'>
			<BackButton />

			<div className='flex flex-row items-center gap-5'>
				<AppIcon
					src={app.icon}
					className='w-[50px] rounded-12 md:w-[100px] md:rounded-20'
					style={{
						viewTransitionName: 'app-icon-' + app.id,
					}}
				/>
				<div className='flex flex-col gap-1 py-1 md:gap-2'>
					<h1
						className='text-16 font-semibold leading-inter-trimmed md:text-24'
						style={{
							viewTransitionName: 'app-name-' + app.id,
						}}
					>
						{app.name}
					</h1>
					<p
						className='text-12 leading-tight opacity-50 md:text-16'
						style={{
							viewTransitionName: 'app-tagline-' + app.id,
						}}
					>
						{app.tagline}
					</p>
					<div className='flex-1' />
					<div className='text-12 delay-100 animate-in fade-in slide-in-from-right-2 fill-mode-both md:text-13'>
						{app.developer}
					</div>
				</div>
				<div className='flex-1' />
				{childrenRight}
			</div>
		</div>
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
	const navigate = useNavigate()

	useEffect(() => {
		if (state === 'installing') {
			navigate({
				search: '?dialog=default-credentials',
			})
		}
	}, [state, navigate])

	return (
		<TopHeader
			app={app}
			childrenRight={
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
			}
		/>
	)
}
