import {Suspense, useCallback, useLayoutEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {Outlet, useLocation, useNavigate} from 'react-router-dom'

import {DialogCloseButton} from '@/components/ui/dialog-close-button'
import {Sheet, SheetContent, SheetTitle} from '@/components/ui/sheet'
import {ScrollArea} from '@/components/ui/sheet-scroll-area'
import {useScrollRestoration} from '@/hooks/use-scroll-restoration'
import {cn} from '@/lib/utils'
import {DockSpacer} from '@/modules/desktop/dock'
import {SheetFixedTarget} from '@/modules/sheet-top-fixed'
import {SheetStickyHeaderProvider, SheetStickyHeaderTarget, useSheetStickyHeader} from '@/providers/sheet-sticky-header'
import {usePauseWallpaperVideo} from '@/providers/wallpaper'
import {useAfterDelayedClose} from '@/utils/dialog'

import {getSheetScrollRestorationAction} from './sheet-scroll-restoration'

// Matches the umbrel-sheet-out duration in index.css, so the route unmounts
// (and the desktop takes back over) right as the close animation lands
const SHEET_EXIT_DURATION_MS = 200

export function SheetLayout() {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const location = useLocation()

	const [open, setOpen] = useState(true)

	const scrollRef = useRef<HTMLDivElement>(null)
	const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null)
	const setScrollViewport = useCallback((element: HTMLDivElement | null) => {
		scrollRef.current = element
		setScrollElement(element)
	}, [])

	useScrollRestoration(scrollRef, getSheetScrollRestorationAction)

	const isSettingsRoute = /^\/settings(\/|$)/.test(location.pathname)
	const isAppStoreRoute = /^\/(?:community-)?app-store(\/|$)/.test(location.pathname)
	// Desktop Files manages its own viewport-relative heights (sidebar reaches
	// below the dock line), so the dock spacer would only add phantom scroll
	const isFilesRoute = /^\/files(\/|$)/.test(location.pathname)
	const isPhotosRoute = /^\/photos(\/|$)/.test(location.pathname)
	const isFullHeightFeatureRoute = isFilesRoute || isPhotosRoute

	// The Sheet layout persists between Files, App Store, and Settings. Clear a
	// stale outer offset before paint when entering Settings. Desktop Settings
	// then delegates scrolling to its two contained panes.
	useLayoutEffect(() => {
		if (isSettingsRoute) scrollRef.current?.scrollTo(0, 0)
	}, [isSettingsRoute])

	useAfterDelayedClose(
		open,
		() => {
			navigate('/')
		},
		SHEET_EXIT_DURATION_MS,
	)

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
								// Search changes the Store header's in-flow height. Let the
								// scroll-linked motion retain its exact depth instead of having
								// browser scroll anchoring silently subtract the rail height.
								isAppStoreRoute && '[overflow-anchor:none]',
							)}
							scrollbarClassName={cn(isSettingsRoute && 'lg:hidden')}
						>
							<div
								className={cn(
									'flex flex-col gap-5 px-3 pt-6 md:px-[40px] md:pt-12',
									isSettingsRoute
										? 'lg:h-full lg:min-h-0 lg:gap-0 lg:pt-0 xl:px-[60px]'
										: isFullHeightFeatureRoute
											? 'xl:px-[60px]'
											: 'xl:px-[70px]',
								)}
							>
								<Suspense fallback={<SheetTitle className='sr-only'>{t('loading')}</SheetTitle>}>
									<Outlet />
								</Suspense>
								{/* Photos runs beneath the dock on every size and keeps the dock's
								    clearance inside its own scrollers, so a spacer here would only
								    hold its listings short of the sheet's bottom edge */}
								<DockSpacer
									className={cn('mt-4', (isSettingsRoute || isFilesRoute) && 'lg:hidden', isPhotosRoute && 'hidden')}
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
