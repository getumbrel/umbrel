import {Suspense, useCallback, useLayoutEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {Outlet, useLocation} from 'react-router-dom'

import {DialogCloseButton} from '@/components/ui/dialog-close-button'
import {Sheet, SheetContent, SheetTitle} from '@/components/ui/sheet'
import {ScrollArea} from '@/components/ui/sheet-scroll-area'
import {useScrollRestoration} from '@/hooks/use-scroll-restoration'
import {cn} from '@/lib/utils'
import {useRevealDesktop} from '@/modules/desktop/desktop-reveal'
import {DockSpacer} from '@/modules/desktop/dock'
import {useTuckDockOnScroll} from '@/modules/desktop/dock-tuck'
import {SheetFixedTarget} from '@/modules/sheet-top-fixed'
import {SheetStickyHeaderProvider, SheetStickyHeaderTarget, useSheetStickyHeader} from '@/providers/sheet-sticky-header'
import {usePauseWallpaperVideo} from '@/providers/wallpaper'
import {useNavigateAfterExit} from '@/utils/dialog'

import {getSheetScrollRestorationAction} from './sheet-scroll-restoration'

export function SheetLayout() {
	const {t} = useTranslation()
	const location = useLocation()

	// A close belongs to the location it was asked on. The layout persists
	// between its routes, so a plain boolean would outlive a navigation that
	// lands mid-close (say, a dock click) and leave the next window shut.
	const [closedLocationKey, setClosedLocationKey] = useState<string>()
	if (closedLocationKey !== undefined && closedLocationKey !== location.key) setClosedLocationKey(undefined)
	const open = closedLocationKey === undefined
	const setOpen = (nextOpen: boolean) => setClosedLocationKey(nextOpen ? undefined : location.key)

	const scrollRef = useRef<HTMLDivElement>(null)
	const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null)
	const setScrollViewport = useCallback((element: HTMLDivElement | null) => {
		scrollRef.current = element
		setScrollElement(element)
	}, [])

	useScrollRestoration(scrollRef, getSheetScrollRestorationAction)
	useTuckDockOnScroll(scrollElement)

	const isSettingsRoute = /^\/settings(\/|$)/.test(location.pathname)
	const isAppStoreRoute = /^\/(?:community-)?app-store(\/|$)/.test(location.pathname)
	// Files fits itself to the sheet at every size: its listing and sidebar scroll
	// inside it, and it handles the dock itself, so the sheet never scrolls
	const isFilesRoute = /^\/files(\/|$)/.test(location.pathname)
	const isPhotosRoute = /^\/photos(\/|$)/.test(location.pathname)
	const isFullHeightFeatureRoute = isFilesRoute || isPhotosRoute

	// The Sheet layout persists between Files, App Store, and Settings. Clear a
	// stale outer offset before paint when entering Settings. Desktop Settings
	// then delegates scrolling to its two contained panes.
	useLayoutEffect(() => {
		if (isSettingsRoute) scrollRef.current?.scrollTo(0, 0)
	}, [isSettingsRoute])

	// The desktop comes back in as the sheet leaves, and takes over once it has
	// gone: the route unmounts right as the close animation lands
	useRevealDesktop(!open)
	useNavigateAfterExit(!open, '/')

	// Only the wallpaper's margins show around the sheet. Keyed on `open` rather
	// than mount so motion is back before the close animation reveals the desktop.
	usePauseWallpaperVideo(open)

	return (
		<>
			<Sheet open={open} onOpenChange={setOpen} modal={false}>
				<SheetStickyHeaderProvider scrollElement={scrollElement}>
					{/* NOTE: If you change these width/max-width values, also update the
					   text editor width in features/files/components/file-viewer/text-viewer/index.tsx
					   which derives its sizing from these same breakpoints. Photos listings
					   counter the desktop right padding below to run to the sheet's edge
					   (features/photos/components/listing/surface.tsx): keep those in
					   step too. */}
					<SheetContent
						side='bottom-zoom'
						className='mx-auto h-[calc(100dvh-var(--sheet-top))] max-w-[1320px] md:w-[calc(100vw-var(--safe-x)-25px-25px)] lg:h-[calc(100dvh-60px-var(--safe-top))] lg:w-[calc(100vw-var(--safe-x)-60px-60px)]'
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
						onOpenAutoFocus={(e) => e.preventDefault()}
						onInteractOutside={(e) => e.preventDefault()}
						onEscapeKeyDown={(e) => e.preventDefault()}
					>
						<SheetFixedTarget />
						<SheetStickyHeaderTarget />
						<ScrollArea
							className='umbrel-window-surface-top h-full'
							fade={!isFullHeightFeatureRoute}
							viewportRef={setScrollViewport}
							viewportClassName={cn(
								isSettingsRoute && 'lg:!overflow-hidden lg:[&>div]:!h-full',
								isFilesRoute && '!overflow-hidden [&>div]:!h-full',
								// Search changes the Store header's in-flow height. Let the
								// scroll-linked motion retain its exact depth instead of having
								// browser scroll anchoring silently subtract the rail height.
								isAppStoreRoute && '[overflow-anchor:none]',
							)}
							scrollbarClassName={cn(isSettingsRoute && 'lg:hidden', isFilesRoute && 'hidden')}
						>
							<div
								className={cn(
									'flex flex-col gap-5 px-3 md:px-[40px]',
									isAppStoreRoute || isSettingsRoute || isFilesRoute
										? 'pt-(--page-top)'
										: // Photos' desktop bar is placed against the 48px above it
											isPhotosRoute
											? 'pt-(--page-top) lg:pt-12'
											: 'pt-6 md:pt-12',
									// On a tablet Files and Photos open on a row of controls beside
									// their title, not on a title alone, and a row of controls wants
									// no more above it than a phone gives it. Set as the variable, so
									// everything of theirs that is measured from it follows
									isFullHeightFeatureRoute && 'tablet:[--page-top:clamp(12px,calc(12dvh_-_32px),24px)]',
									isSettingsRoute
										? 'lg:h-full lg:min-h-0 lg:gap-0 lg:pt-0 xl:px-[60px] low:gap-3'
										: isFullHeightFeatureRoute
											? cn('xl:px-[60px]', isFilesRoute && 'h-full')
											: 'xl:px-[70px]',
								)}
							>
								<Suspense fallback={<SheetTitle className='sr-only'>{t('loading')}</SheetTitle>}>
									<Outlet />
								</Suspense>
								{/* Files and Photos keep the dock's clearance inside their own layouts,
								    so a spacer here would only hold them short of the sheet's bottom edge */}
								<DockSpacer
									className={cn('mt-4', isSettingsRoute && 'lg:hidden', isFullHeightFeatureRoute && 'hidden')}
								/>
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

	// A sticky header portals in its own close button
	if (showStickyHeader) return null

	return <DialogCloseButton surface='sheet' />
}
