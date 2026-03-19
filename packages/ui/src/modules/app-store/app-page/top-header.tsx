import {ReactNode} from 'react'
import {TbArrowLeft, TbCircleArrowLeftFilled} from 'react-icons/tb'
import {useLocation, useNavigate} from 'react-router-dom'

import {AppIcon} from '@/components/app-icon'
import {Badge} from '@/components/ui/badge'
import {DialogCloseButton} from '@/components/ui/dialog-close-button'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {cn} from '@/lib/utils'
import {SheetFixedContent} from '@/modules/sheet-top-fixed'
import {SheetStickyHeader} from '@/providers/sheet-sticky-header'
import {RegistryApp} from '@/trpc/trpc'
import {dialogHeaderCircleButtonClass} from '@/utils/element-classes'
import {t} from '@/utils/i18n'

export const TopHeader = ({app, childrenRight}: {app: RegistryApp; childrenRight: ReactNode}) => {
	const isMobile = useIsMobile()
	return (
		<>
			{!isMobile && (
				<SheetStickyHeader className='flex h-full w-full items-center gap-2.5'>
					<BackButton />
					<div className='flex flex-1 items-center gap-2.5'>
						<AppIcon src={app.icon} size={32} className='rounded-8' />
						<span className='truncate text-16 font-semibold -tracking-4 md:text-19'>{app.name}</span>
					</div>
					{childrenRight}
					<DialogCloseButton />
				</SheetStickyHeader>
			)}
			<div className='space-y-5'>
				{/*
				Tricky to get good behavior for this:
				- Naturally, we want to just go back to the previous page
				- However, when coming from home page, we want to go back to the app store
				- After clicking related apps, it's not clear what the back button should do
				*/}

				{isMobile ? (
					<SheetFixedContent>
						<BackButton />
					</SheetFixedContent>
				) : (
					<BackButton />
				)}

				<div data-testid='app-top' className='flex flex-col items-center items-stretch gap-5 max-md:mt-5 md:flex-row'>
					<div className='flex min-w-0 flex-1 items-center gap-2.5 max-md:px-2.5 md:gap-5'>
						<AppIcon src={app.icon} size={isMobile ? 64 : 100} className='rounded-12 lg:rounded-20' />
						<div className='flex min-w-0 flex-col items-start gap-1.5 py-1 md:gap-2'>
							<h1 className='flex flex-wrap items-center gap-2 text-16 leading-inter-trimmed font-semibold md:text-24'>
								{app.name} {app.optimizedForUmbrelHome && <Badge>{t('app.optimized-for-umbrel-home')}</Badge>}
							</h1>
							<p className='line-clamp-2 w-full text-12 leading-tight opacity-50 md:line-clamp-1 md:text-16'>
								{app.tagline}
							</p>
							{!isMobile && (
								<>
									<div className='flex-1' />
									<div className='animate-in text-12 delay-100 fill-mode-both fade-in slide-in-from-right-2 md:text-13'>
										{app.developer}
									</div>
								</>
							)}
						</div>
					</div>
					{childrenRight}
				</div>
			</div>
		</>
	)
}

function BackButton() {
	const navigate = useNavigate()
	const location = useLocation()
	const isMobile = useIsMobile()

	const handleBack = () => {
		if (location.state?.fromAppStore) {
			navigate(-1)
		} else {
			// Came from outside the app store (e.g. Files, home screen, deep link),
			// so navigate to the app store root instead of leaking into another section
			const isCommunity = location.pathname.startsWith('/community-app-store/')
			if (isCommunity) {
				const storeId = location.pathname.split('/')[2]
				navigate(`/community-app-store/${storeId}`)
			} else {
				navigate('/app-store')
			}
		}
	}

	if (isMobile) {
		return (
			<button className={cn(dialogHeaderCircleButtonClass, 'absolute top-2.5 left-2.5 z-50')} onClick={handleBack}>
				<TbCircleArrowLeftFilled className='h-5 w-5' />
			</button>
		)
	}

	return (
		<button onClick={handleBack}>
			<TbArrowLeft className='h-5 w-5' />
		</button>
	)
}
