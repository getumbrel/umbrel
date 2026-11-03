import {motion, useReducedMotion, useTransform} from 'motion/react'
import {ReactNode, useLayoutEffect, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {TbCircleArrowLeftFilled} from 'react-icons/tb'
import {useLocation, useNavigate} from 'react-router-dom'

import {AppIcon} from '@/components/app-icon'
import {DialogCloseButton} from '@/components/ui/dialog-close-button'
import {storeRevealDelay, storeRevealSoftClass} from '@/features/app-store/constants'
import {useStickyCollapse} from '@/features/app-store/hooks/use-sticky-collapse'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {cn} from '@/lib/utils'
import {SheetFixedContent} from '@/modules/sheet-top-fixed'
import {SheetStickyHeader, useSheetStickyHeader} from '@/providers/sheet-sticky-header'
import {RegistryApp} from '@/trpc/trpc'
import {dialogHeaderCircleButtonClass} from '@/utils/element-classes'

type HeroProps = {app: RegistryApp; renderActions: () => ReactNode}

export function AppPageHero({app, renderActions}: HeroProps) {
	const isMobile = useIsMobile()
	return (
		<>
			<SheetBackButton />
			{isMobile ? (
				<MobileAppHero app={app} renderActions={renderActions} />
			) : (
				<DesktopAppHero app={app} renderActions={renderActions} />
			)}
		</>
	)
}

function SheetBackButton() {
	const {t} = useTranslation()
	const handleBack = useBackNavigation()
	return (
		<SheetFixedContent>
			<button
				type='button'
				className={cn(dialogHeaderCircleButtonClass, 'absolute top-3 left-3 z-60 lg:top-5 lg:left-5')}
				onClick={handleBack}
				aria-label={t('back')}
			>
				<TbCircleArrowLeftFilled className='h-5 w-5 lg:h-6 lg:w-6' />
			</button>
		</SheetFixedContent>
	)
}

const HERO_HEIGHT = 120
const BAR_HEIGHT = 64
const BAR_CENTER = BAR_HEIGHT / 2
const COLLAPSE_DISTANCE = 90
const ICON_BAR_SIZE = 36
const CORNER_INSET = 20
const CORNER_BUTTON_SIZE = 24

function DesktopAppHero({app, renderActions}: HeroProps) {
	const {scrollElement} = useSheetStickyHeader()
	const [anchor, setAnchor] = useState<HTMLDivElement | null>(null)
	const {progress, wrapperY, pinned, settled} = useStickyCollapse(anchor, COLLAPSE_DISTANCE)
	const reduceMotion = Boolean(useReducedMotion())
	const reducedProgress = useTransform(progress, (value): number => (value > 0 ? 1 : 0))
	const collapseProgress = reduceMotion ? reducedProgress : progress

	const [contentInset, setContentInset] = useState(70)
	useLayoutEffect(() => {
		if (!anchor || !scrollElement) return
		const measure = () => {
			setContentInset(anchor.getBoundingClientRect().left - scrollElement.getBoundingClientRect().left)
		}
		measure()
		const observer = new ResizeObserver(measure)
		observer.observe(anchor)
		observer.observe(scrollElement)
		window.addEventListener('resize', measure)
		return () => {
			observer.disconnect()
			window.removeEventListener('resize', measure)
		}
	}, [anchor, scrollElement])

	// Preserve a 12px lane beside the fixed corner controls when the content
	// inset narrows below xl, applying the same correction to both edges.
	const compactInsetAdjustment = Math.max(0, CORNER_INSET + CORNER_BUTTON_SIZE + 12 - contentInset)
	const iconX = useTransform(collapseProgress, [0, 1], [0, compactInsetAdjustment])
	const iconY = useTransform(collapseProgress, [0, 1], [0, BAR_CENTER - ICON_BAR_SIZE / 2])
	const iconScale = useTransform(collapseProgress, [0, 1], [1, ICON_BAR_SIZE / HERO_HEIGHT])
	// The radius is applied to the same wrapper as the scale. Its 26.67px final
	// value scales to an exact 8px corner in the compact bar.
	const iconRadius = useTransform(collapseProgress, [0, 1], [30, 8 / (ICON_BAR_SIZE / HERO_HEIGHT)])
	const nameX = useTransform(collapseProgress, [0, 1], [140, compactInsetAdjustment + ICON_BAR_SIZE + 10])
	const nameY = useTransform(collapseProgress, [0, 1], [18, 25])
	const nameScale = useTransform(collapseProgress, [0, 1], [1, 19 / 32])
	const metaOpacity = useTransform(collapseProgress, [0, 0.5], [1, 0])
	const metaY = useTransform(collapseProgress, [0, 1], [54, BAR_CENTER + 24])
	const actionsX = useTransform(collapseProgress, [0, 1], [0, -compactInsetAdjustment])
	const actionsY = useTransform(collapseProgress, [0, 1], [40, BAR_CENTER - 20])

	return (
		<>
			<div ref={setAnchor} data-testid='app-hero-anchor' className='h-[120px]' />

			{anchor && (
				<SheetFixedContent>
					<motion.div
						data-testid='app-scroll-hero'
						style={{y: wrapperY}}
						className='pointer-events-none absolute inset-x-0 top-0 z-[55]'
					>
						<div className='relative mx-3 h-[120px] md:mx-[40px] xl:mx-[70px]'>
							<motion.div
								style={{x: iconX, y: iconY, scale: iconScale, borderRadius: iconRadius}}
								className='absolute top-0 left-0 origin-top-left'
							>
								<AppIcon
									src={app.icon}
									size={HERO_HEIGHT}
									className={cn('rounded-[inherit] border-white/5', storeRevealSoftClass)}
									style={storeRevealDelay(40)}
								/>
							</motion.div>
							<motion.div
								style={{x: nameX, y: nameY, scale: nameScale}}
								className='absolute top-0 right-[300px] left-0 flex origin-top-left items-center'
							>
								<h1
									className={cn('min-w-0 truncate text-32 leading-inter-trimmed font-semibold', storeRevealSoftClass)}
									style={storeRevealDelay(90)}
								>
									{app.name}
								</h1>
							</motion.div>
							<motion.div
								style={{x: 140, y: metaY, opacity: metaOpacity}}
								className='absolute top-0 right-[300px] left-0'
							>
								<div className={cn('flex flex-col gap-1.5', storeRevealSoftClass)} style={storeRevealDelay(130)}>
									<p className='truncate text-15 leading-tight opacity-50'>{app.tagline}</p>
									<p className='truncate text-13 text-white/35'>{app.developer}</p>
								</div>
							</motion.div>
							<motion.div style={{x: actionsX, y: actionsY}} className='pointer-events-auto absolute top-0 right-0'>
								<div
									className={cn('flex items-center gap-3 md:gap-4', storeRevealSoftClass)}
									style={storeRevealDelay(170)}
								>
									{renderActions()}
								</div>
							</motion.div>
						</div>
					</motion.div>
				</SheetFixedContent>
			)}

			<SheetStickyHeader visible={pinned} surfaceVisible={settled} animateContent={false} fadeSurface>
				<DialogCloseButton surface='sheet' />
			</SheetStickyHeader>
		</>
	)
}

function MobileAppHero({app, renderActions}: HeroProps) {
	return (
		<div className={cn('space-y-5', storeRevealSoftClass)}>
			<div
				data-testid='app-top'
				className='mt-5 flex flex-col items-stretch gap-5 sm:flex-row sm:items-center sm:gap-6'
			>
				<div className='flex min-w-0 flex-1 items-center gap-3 sm:gap-4'>
					<AppIcon src={app.icon} className='size-16 rounded-15 border-white/5 sm:size-24 sm:rounded-24' />
					<div className='flex min-w-0 flex-col items-start gap-1 py-1 sm:gap-1.5'>
						<h1 className='text-16 leading-inter-trimmed font-semibold sm:text-24'>{app.name}</h1>
						<p className='line-clamp-2 w-full text-12 leading-tight opacity-50 sm:text-15'>{app.tagline}</p>
						<p className='hidden truncate text-13 text-white/35 sm:block'>{app.developer}</p>
					</div>
				</div>
				<div className='sm:shrink-0'>{renderActions()}</div>
			</div>
		</div>
	)
}

function useBackNavigation() {
	const navigate = useNavigate()
	const location = useLocation()

	return () => {
		if (location.state?.fromAppStore) {
			navigate(-1)
		} else {
			const isCommunity = location.pathname.startsWith('/community-app-store/')
			if (isCommunity) {
				const storeId = location.pathname.split('/')[2]
				navigate(`/community-app-store/${storeId}`)
			} else {
				navigate('/app-store')
			}
		}
	}
}
