import {ReactNode, useEffect, useState} from 'react'
import {TbArrowLeft} from 'react-icons/tb'
import {useNavigate} from 'react-router-dom'

import {AppIcon} from '@/components/app-icon'
import {InstallButton} from '@/components/install-button'
import {useDemoInstallProgress} from '@/hooks/use-demo-progress'
import {RegistryApp} from '@/trpc/trpc'
import {portToUrl} from '@/utils/misc'
import {trackAppOpen} from '@/utils/track-app-open'

export const TopHeader = ({app, childrenRight}: {app: RegistryApp; childrenRight: ReactNode}) => {
	const navigate = useNavigate()

	return (
		<div className='space-y-5'>
			<button onClick={() => navigate(-1)}>
				<TbArrowLeft className='h-5 w-5' />
			</button>

			<div className='flex flex-row items-center gap-5'>
				<AppIcon
					src={app.icon}
					size={100}
					className='rounded-20'
					style={{
						viewTransitionName: 'app-icon-' + app.id,
					}}
				/>
				<div className='flex flex-col gap-2 py-1'>
					<h1
						className='text-24 font-semibold leading-inter-trimmed'
						style={{
							viewTransitionName: 'app-name-' + app.id,
						}}
					>
						{app.name}
					</h1>
					<p
						className='text-16 leading-tight opacity-50'
						style={{
							viewTransitionName: 'app-tagline-' + app.id,
						}}
					>
						{app.tagline}
					</p>
					<div className='flex-1' />
					<div className='text-13 delay-100 animate-in fade-in slide-in-from-right-2 fill-mode-both'>
						{app.developer}
					</div>
				</div>
				<div className='flex-1' />
				{childrenRight}
			</div>
		</div>
	)
}

export const TopHeaderWithDummyInstall = ({app}: {app: RegistryApp}) => {
	const {progress, state, install} = useDemoInstallProgress()

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
