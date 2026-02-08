import {Suspense, useRef, useState} from 'react'
import {NavigationType, Outlet, useLocation, useNavigate} from 'react-router-dom'

import {DialogCloseButton} from '@/components/ui/dialog-close-button'
import {useScrollRestoration} from '@/hooks/use-scroll-restoration'
import {DockSpacer} from '@/modules/desktop/dock'
import {SheetFixedTarget} from '@/modules/sheet-top-fixed'
import {SheetStickyHeaderProvider, SheetStickyHeaderTarget, useSheetStickyHeader} from '@/providers/sheet-sticky-header'
import {isFullscreenSettingsPath} from '@/routes/settings'
import {Sheet, SheetContent} from '@/shadcn-components/ui/sheet'
import {ScrollArea} from '@/shadcn-components/ui/sheet-scroll-area'
import {useAfterDelayedClose} from '@/utils/dialog'

// Determine if scroll position should be restored (`true`), reset (`false`) or
// ignored (`undefined`). SheetLayout is shared accross settings, app store and
// so on, so we are handling multiple paths here, with the option to precisely
// handle scroll restoration between any two paths using SheetLayout.
const scrollRestorationHandler = (thisPathname: string, prevPathname: string, navigationType: NavigationType) => {
	// Ignore scroll restoration in settings (only has dialogs)
	const isSettings = /^\/settings(\/|$)/.test(thisPathname)
	if (isSettings) {
		return 'ignore'
	}
	// Reset scroll position to zero unless going back in history
	if (navigationType !== 'POP') {
		return 'reset'
	}
	// In app store, restore position when navigating back from an app
	const isAppStore = /^\/app-store(\/|$)/.test(thisPathname)
	if (isAppStore) {
		const cameFromApp = /^\/app-store\/[^/]+$/.test(prevPathname)
		return cameFromApp ? 'restore' : 'reset'
	}
	// Otherwise reset scroll position to zero
	return 'reset'
}

export function SheetLayout() {
	const navigate = useNavigate()
	const location = useLocation()

	const [open, setOpen] = useState(true)

	const scrollRef = useRef<HTMLDivElement>(null)

	useScrollRestoration(scrollRef, scrollRestorationHandler)

	// For fullscreen settings routes, render content outside the Sheet
	const isFullscreenRoute = isFullscreenSettingsPath(location.pathname)

	useAfterDelayedClose(open, () => {
		// Don't navigate away if we're on a fullscreen route
		if (!isFullscreenRoute) {
			navigate('/')
		}
	})

	return (
		<>
			{/* Render fullscreen content outside the Sheet */}
			{isFullscreenRoute && (
				<>
					{/* Immediate blur backdrop - renders before lazy component loads */}
					<div className='fixed inset-0 z-50 bg-black/30 backdrop-blur-xl' />
					<Suspense fallback={null}>
						<Outlet />
					</Suspense>
				</>
			)}
			{/* Keep Sheet mounted but closed when on fullscreen route */}
			<Sheet open={open && !isFullscreenRoute} onOpenChange={setOpen} modal={false}>
				<SheetStickyHeaderProvider scrollRef={scrollRef}>
					<SheetContent
						side='bottom-zoom'
						className='mx-auto h-[calc(100dvh-var(--sheet-top))] max-w-[1320px] md:w-[calc(100vw-25px-25px)] lg:h-[calc(100dvh-60px)] lg:w-[calc(100vw-60px-60px)]'
						backdrop={
							open && (
								<div
									data-state={open ? 'open' : 'closed'}
									className='fixed inset-0 z-30'
									onClick={() => setOpen(false)}
								/>
							)
						}
						closeButton={<SheetCloseButton />}
						onInteractOutside={(e) => e.preventDefault()}
						onEscapeKeyDown={(e) => e.preventDefault()}
					>
						<SheetFixedTarget />
						<SheetStickyHeaderTarget />
						<ScrollArea className='h-full rounded-t-20' viewportRef={scrollRef}>
							<div className='flex flex-col gap-5 px-3 pt-6 md:px-[40px] md:pt-12 xl:px-[70px]'>
								<Suspense>
									<Outlet />
								</Suspense>
								<DockSpacer className='mt-4' />
							</div>
						</ScrollArea>
					</SheetContent>
				</SheetStickyHeaderProvider>
			</Sheet>
		</>
	)
}

function SheetCloseButton() {
	const {showStickyHeader} = useSheetStickyHeader()

	if (showStickyHeader) return null

	return <DialogCloseButton className='absolute top-2.5 right-2.5 z-50' />
}
