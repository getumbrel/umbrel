import {ReactNode} from 'react'
import {TbArrowLeft} from 'react-icons/tb'
import {useNavigate} from 'react-router-dom'

import {AppIcon} from '@/components/app-icon'
import {DialogCloseButton} from '@/components/ui/dialog-close-button'
import {SheetStickyHeader} from '@/modules/sheet-sticky-header'
import {Badge} from '@/shadcn-components/ui/badge'
import {RegistryApp} from '@/trpc/trpc'

export const TopHeader = ({app, childrenRight}: {app: RegistryApp; childrenRight: ReactNode}) => {
	return (
		<>
			<SheetStickyHeader className='flex h-full w-full items-center gap-2.5'>
				<BackButton />
				<div className='flex flex-1 items-center gap-2.5'>
					<AppIcon src={app.icon} className='w-[32px] rounded-8' />
					<span className='truncate text-16 font-semibold -tracking-4 md:text-19'>{app.name}</span>
				</div>
				{childrenRight}
				<DialogCloseButton />
			</SheetStickyHeader>
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
						<h1 className='flex items-center gap-2 text-16 font-semibold leading-inter-trimmed md:text-24'>
							{app.name} {app.optimizedForUmbrelHome && <Badge>Optimized for Umbrel Home</Badge>}
						</h1>
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
