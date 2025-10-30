import {AnimatePresence, motion} from 'framer-motion'
import {useMemo, useState} from 'react'
import {TbLoader} from 'react-icons/tb'

import {Card} from '@/components/ui/card'
import stickerBgUrl from '@/features/files/assets/rewind-sticker-bg.svg'
import {EmbeddedFiles} from '@/features/files/components/embedded'
import {APPS_PATH, HOME_PATH} from '@/features/files/constants'
import {useNavigate as useFilesNavigate} from '@/features/files/hooks/use-navigate'
import {formatFilesystemDateOnly} from '@/features/files/utils/format-filesystem-date'
import {cn} from '@/shadcn-lib/utils'
import {t} from '@/utils/i18n'
import type {SupportedLanguageCode} from '@/utils/language'

export function SnapshotCarousel({
	backupsForTimeline,
	activeIndex,
	noCarousel,
	explorerVisible,
	explorerScale,
	lang,
	wallpaperUrl,
	mountedDir,
	explorerContainerRef,
}: {
	backupsForTimeline: {id: string; time: number}[]
	activeIndex: number
	noCarousel: boolean
	explorerVisible: boolean
	explorerScale: number
	lang: string
	wallpaperUrl?: string
	mountedDir: string | null
	explorerContainerRef: React.RefObject<HTMLDivElement>
}) {
	const windowStart = noCarousel ? activeIndex : Math.max(0, activeIndex - 2)
	const windowEnd = noCarousel ? activeIndex : Math.min(backupsForTimeline.length - 1, activeIndex + 2)

	// Derive initial path for the embedded Files explorer:
	// - If the user is currently in /Home or /Apps, keep that path
	// - Otherwise, fall back to /Home
	const {currentPath} = useFilesNavigate()
	const safeInitialPath =
		currentPath.startsWith(APPS_PATH) || currentPath.startsWith(HOME_PATH) ? currentPath : HOME_PATH

	// Persist the user's in‑Rewind navigation across snapshot switches.
	const [rewindPath, setRewindPath] = useState<string>(safeInitialPath)

	// Calculate animation properties
	const visibleSnapshots = useMemo(() => {
		return backupsForTimeline.slice(windowStart, windowEnd + 1).map((b, i) => {
			const index = windowStart + i
			const delta = index - activeIndex
			const isActive = index === activeIndex

			// Positioning with equidistant spacing
			const overlapX = noCarousel ? 0 : Math.max(-2, Math.min(2, delta)) * 60

			// Smooth scale transitions gradual scaling
			const scale = noCarousel ? 1 : Math.max(0.9, 1 - Math.min(Math.abs(delta), 2) * 0.05)

			// z-index layering
			const z = 100 - Math.abs(delta)

			// Gentle blur effect
			const blurPx = isActive ? 0 : Math.min(1.5, Math.max(0, Math.abs(delta)) * 0.6)

			// Calculate initial positions for smooth entry
			const initialX = delta > 0 ? overlapX + 80 : delta < 0 ? overlapX - 80 : overlapX
			const initialScale = delta !== 0 ? Math.max(0.7, scale * 0.9) : scale

			// Calculate animation delay for staggered effect
			const delay = Math.abs(delta) * 0.1

			return {
				backup: b,
				index,
				delta,
				isActive,
				overlapX,
				scale,
				z,
				blurPx,
				initialX,
				initialScale,
				delay,
			}
		})
	}, [backupsForTimeline, windowStart, windowEnd, activeIndex, noCarousel])

	return (
		<AnimatePresence mode='popLayout'>
			{visibleSnapshots.map((snapshot) => (
				<motion.div
					key={snapshot.backup.id}
					className='absolute inset-0'
					style={{zIndex: snapshot.z, filter: `blur(${snapshot.blurPx}px)`}}
					initial={{x: snapshot.initialX, scale: snapshot.initialScale, opacity: 0}}
					animate={{
						x: snapshot.overlapX,
						scale: snapshot.scale,
						opacity: 1,
					}}
					exit={{x: snapshot.initialX, scale: snapshot.initialScale, opacity: 0}}
					transition={{
						type: 'spring',
						stiffness: 300,
						damping: 30,
						delay: snapshot.delay,
						opacity: {duration: 0.2},
					}}
				>
					<Card className='relative h-full w-full overflow-hidden rounded-2xl bg-black p-0 shadow-2xl lg:p-0'>
						<div className='pointer-events-none absolute inset-0'>
							<div
								className='absolute inset-0 bg-cover bg-center opacity-90'
								style={{backgroundImage: `url(${wallpaperUrl || ''})`}}
							/>
							{!noCarousel &&
								(() => {
									const label =
										snapshot.backup.id === 'current'
											? t('rewind.now')
											: formatFilesystemDateOnly(snapshot.backup.time, lang as SupportedLanguageCode)
									const useStickerFont = (
										['en', 'de', 'es', 'fr', 'it', 'hu', 'nl', 'pt', 'tr'] as Array<SupportedLanguageCode>
									).includes(lang as SupportedLanguageCode)
									return (
										<div className='absolute left-1 top-24 z-20 select-none'>
											<div className='origin-top-left translate-y-full -rotate-[88deg]'>
												<div className='relative inline-flex items-center justify-center'>
													<img src={stickerBgUrl} alt='' className='h-8 w-auto' />
													<div
														className={cn(
															'absolute text-xs font-normal uppercase tracking-wide text-black',
															useStickerFont ? 'font-sticker' : 'font-sans',
														)}
													>
														{label}
													</div>
												</div>
											</div>
										</div>
									)
								})()}
						</div>

						{snapshot.isActive ? (
							<div className='flex h-full items-end justify-center px-4 pb-0 pt-4 lg:px-8 lg:pt-8'>
								<div
									ref={explorerContainerRef}
									className='relative size-full max-w-[clamp(320px,92vw,1040px)] overflow-hidden rounded-t-2xl backdrop-blur-3xl backdrop-brightness-[0.3] backdrop-saturate-[1.2]'
								>
									<div
										className={cn(
											'absolute inset-0 flex items-center justify-center transition-opacity duration-200',
											explorerVisible ? 'pointer-events-none opacity-0' : 'opacity-100',
										)}
									>
										<TbLoader className='h-8 w-8 animate-spin text-white/60' />
									</div>

									{/* Without drag-and-drop, we make sure to disable all text selection in the embedded Files feature with select-none. */}
									<div
										className={cn(
											'absolute inset-0 origin-top-left scale-[var(--ft-scale)] select-none px-3 pt-4 transition-opacity duration-200 md:px-6 md:pt-6',
											explorerVisible ? 'opacity-100' : 'pointer-events-none opacity-0',
										)}
										style={
											{
												['--ft-scale' as any]: explorerScale,
												width: `calc(100% / ${explorerScale})`,
												height: `calc(100% / ${explorerScale})`,
											} as any
										}
									>
										<EmbeddedFiles
											mode='read-only'
											initialPath={safeInitialPath}
											currentPath={rewindPath}
											onNavigate={setRewindPath}
											// Pass the scale used by the carousel so marquee selection inside the embedded explorer compensates for the transform.
											explorerScale={explorerScale}
											pathAliases={
												mountedDir
													? {['/Home']: `/Backups/${mountedDir}/Home`, ['/Apps']: `/Backups/${mountedDir}/Apps`}
													: undefined
											}
										/>
									</div>
								</div>
							</div>
						) : (
							<div className='absolute inset-0 bg-black/20' />
						)}
					</Card>
				</motion.div>
			))}
		</AnimatePresence>
	)
}
