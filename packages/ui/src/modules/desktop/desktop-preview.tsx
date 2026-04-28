import {useEffect, useState} from 'react'

import {FadeInImg} from '@/components/ui/fade-in-img'
import {useWidgets} from '@/hooks/use-widgets'
import {LoadingWidget} from '@/modules/widgets'
import {BackdropBlurVariantContext} from '@/modules/widgets/shared/backdrop-blur-context'
import {WidgetWrapper} from '@/modules/widgets/shared/widget-wrapper'
import {useApps} from '@/providers/apps'
import {useWallpaper} from '@/providers/wallpaper'
import {trpcReact} from '@/trpc/trpc'

import {AppGrid} from './app-grid/app-grid'
import {AppIcon} from './app-icon'
import {DockPreview} from './dock'
import {Header} from './header'

/**
 * Miniature desktop preview shown in Settings.
 *
 * Renders the real desktop components (Header, AppGrid, AppIcon, DockPreview,
 * WidgetWrapper) so the preview stays in sync with the actual desktop layout
 * without maintaining a parallel implementation. The expensive part — live
 * widget data — is avoided by using <LoadingWidget> (renders the correct
 * widget type with placeholder dashes, zero API calls or iframes).
 *
 * Structure (bottom → top):
 *   1. Wallpaper — small pre-generated jpg, updates instantly on wallpaper change
 *   2. Content  — real components laid out at 1440×850, then scale3d(0.18) to ~259×153
 *   3. Dock     — DockPreview with fixed "preview" dimensions (viewport-independent)
 *
 * Note: On narrow viewports, responsive Tailwind classes (sm:/md:) still respond
 * to the viewport rather than the 1440px container, so some widget/icon styling
 * may differ slightly from the true desktop appearance. This is acceptable at
 * the tiny preview size (~259×153px).
 */
export function DesktopPreviewConnected() {
	const W = 1440
	const H = 850
	const scale = 0.18

	const wallpaper = useWallpaper()

	// Defer mounting so the Settings page paints first, then show the preview
	// on the next frame. No fade-in animation — backdrop-filter on widgets can't
	// be smoothly faded (browsers skip compositing it at opacity 0, causing a
	// flash when it kicks in). A clean pop-in looks fine at this tiny preview size.
	const [show, setShow] = useState(false)
	useEffect(() => {
		const id = requestAnimationFrame(() => setShow(true))
		return () => cancelAnimationFrame(id)
	}, [])

	return (
		<>
			{/* Small wallpaper image — avoids loading the full-res Wallpaper component */}
			<FadeInImg
				key={wallpaper.wallpaper.id}
				src={`/assets/wallpapers/generated-small/${wallpaper.wallpaper.id}.jpg`}
				className='absolute inset-0 h-full w-full object-cover object-center'
				style={{animation: 'animate-unblur 0.7s'}}
			/>
			<div
				className='shrink-0 origin-top-left'
				style={{
					transform: `scale3d(${scale}, ${scale}, 1)`,
				}}
			>
				<div
					className='relative'
					style={
						{
							width: W,
							height: H,
							// Desktop ("M" breakpoint) CSS custom properties so descendants
							// using var(--app-w) etc. get desktop values regardless of viewport.
							'--app-w': '120px',
							'--app-h': '110px',
							'--app-x-gap': '30px',
							'--app-y-gap': '12px',
							'--apps-padding-x': '32px',
							'--widget-h': '150px',
							'--widget-w': '270px',
							'--widget-labeled-h': '176px',
							'--apps-max-w': '934px',
						} as React.CSSProperties
					}
				>
					{show && (
						<div className='flex h-full flex-col items-center justify-between overflow-hidden'>
							<DesktopPreviewContent />
							<div className='pb-5'>
								<DockPreview />
							</div>
						</div>
					)}
				</div>
			</div>
		</>
	)
}

/** Real desktop content using actual components but with LoadingWidget instead of
 *  live Widget to avoid tRPC queries and cross-origin iframes. */
function DesktopPreviewContent() {
	const {userApps, isLoading} = useApps()
	const {selected} = useWidgets()
	const getQuery = trpcReact.user.get.useQuery()
	const name = getQuery.data?.name

	if (isLoading) return null
	if (!userApps) return null
	if (!name) return null

	return (
		<BackdropBlurVariantContext value='with-backdrop-blur'>
			{/* <BackdropBlurVariantContext value='default'> */}
			<div className='pt-12' />
			<Header userName={name} />
			<div className='pt-12' />
			<div className='flex w-full flex-grow overflow-hidden'>
				<AppGrid
					onlyFirstPage
					forceDesktop
					widgets={selected?.map((widget) => (
						<WidgetWrapper key={widget.id} label={widget.app.name}>
							<LoadingWidget type={widget.type} />
						</WidgetWrapper>
					))}
					apps={userApps.map((app) => (
						<AppIcon key={app.id} src={app.icon} label={app.name} onClick={() => {}} />
					))}
				/>
			</div>
		</BackdropBlurVariantContext>
	)
}

/** Decorative frame (border + shadow) that wraps the preview at its final scaled size. */
export function DesktopPreviewFrame({children}: {children: React.ReactNode}) {
	const W = 1440
	const H = 850
	const scale = 0.18

	return (
		<div
			className='max-h-fit max-w-fit rounded-15 p-[1px]'
			style={{
				backgroundImage:
					'linear-gradient(135deg, rgba(237, 237, 237, 0.42) 0.13%, rgba(173, 173, 173, 0.12) 26.95%, rgba(0, 0, 0, 0.00) 81.15%, #404040 105.24%)',
				filter:
					'drop-shadow(0px 0px 0.6332594156265259px rgba(0, 21, 64, 0.14)) drop-shadow(0px 0.6332594156265259px 1.2665188312530518px rgba(0, 21, 64, 0.05))',
			}}
		>
			<div className='rounded-15 bg-[#0C0D0C] p-[9px]'>
				<div
					className='relative animate-in overflow-hidden rounded-5 duration-100 fade-in'
					style={{
						width: W * scale,
						height: H * scale,
						transform: `translateZ(0)`, // Force rounded border clipping in Safari
					}}
					// Tell screen readers to ignore this element
					aria-hidden='true'
					// Prevent browser from interacting with children
					ref={(node) => {
						if (node) node.setAttribute('inert', '')
					}}
				>
					{children}
				</div>
			</div>
		</div>
	)
}
