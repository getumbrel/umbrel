// The screens around the storage step: looking for drives, finding none, finding an earlier
// Umbrel setup, creating the storage, and what comes after. They only show what they are
// given, so the same screens serve onboarding and the storage lab.

import {AnimatePresence, motion, useReducedMotion} from 'motion/react'
import {useId} from 'react'
import {useTranslation} from 'react-i18next'
import {IoShieldHalf} from 'react-icons/io5'
import {TbAlertTriangleFilled, TbCheck, TbServer} from 'react-icons/tb'

import hardDrive from '@/features/storage/assets/hard-drive.webp'
import {primaryButtonProps, secondaryButtonClasss} from '@/layouts/bare/shared'
import {Progress} from '@/modules/bare/progress'

import {DriveBay, DriveView} from '../art'
import {DriveKind, FailsafeLayout, formatSize} from '../model'
import {Disclosure, StepHeader, titleGlow} from '../parts'
import {forKind} from '../words'

function Centered({children}: {children: React.ReactNode}) {
	return <div className='flex flex-1 flex-col items-center justify-center gap-4 px-2 py-8'>{children}</div>
}

function ProFront() {
	const {t} = useTranslation()
	return (
		<div className='flex flex-col items-center gap-2'>
			<img src='/assets/onboarding/pro-front.webp' alt='' draggable={false} className='w-64 md:w-96' />
			<p className='text-13 font-medium text-white/30'>{t('storage-manager.umbrel-pro')}</p>
		</div>
	)
}

// A beat, not a wait: long enough to see that Umbrel looked
export function ScanStage({isPro}: {isPro: boolean}) {
	const {t} = useTranslation()
	const reduceMotion = useReducedMotion()
	if (isPro) {
		// The scan Umbrel Pro already has: a line of light passing over the four slots
		return (
			<div className='flex flex-1 flex-col items-center justify-center gap-10' role='status'>
				<div className='relative flex items-center justify-center'>
					<img src='/assets/onboarding/ssd-scan.webp' alt='' draggable={false} className='aspect-square w-[300px]' />
					{!reduceMotion && (
						<motion.div
							className='pointer-events-none absolute w-[340px]'
							style={{
								height: '2px',
								background: 'white',
								boxShadow: '0 0 10px 2px rgba(255, 255, 255, 0.6), 0 0 20px 4px rgba(255, 255, 255, 0.3)',
							}}
							animate={{y: ['-120px', '120px', '-120px']}}
							transition={{duration: 4.4, repeat: Infinity, ease: 'easeInOut'}}
						/>
					)}
				</div>
				<span className='text-15 text-white/85' style={titleGlow}>
					{t('storage-setup.scan.ssd')}
				</span>
			</div>
		)
	}
	return (
		<div className='flex flex-1 flex-col items-center justify-center gap-8' role='status'>
			<div className='relative flex size-[150px] items-center justify-center'>
				{!reduceMotion &&
					[0, 1].map((ring) => (
						<motion.span
							key={ring}
							className='absolute inset-0 rounded-full border border-white/25'
							// The rings start just clear of the drive and spread from it, rather than
							// passing through it
							initial={{scale: 0.72, opacity: 0}}
							animate={{scale: 1.15, opacity: [0, 0.5, 0]}}
							transition={{duration: 2.2, repeat: Infinity, ease: 'easeOut', delay: ring * 1.1}}
						/>
					))}
				<img src={hardDrive} alt='' draggable={false} className='relative w-[76px]' />
			</div>
			<span className='text-15 text-white/85' style={titleGlow}>
				{t('storage-setup.scan.drive')}
			</span>
		</div>
	)
}

// Umbrel Pro with nothing in its tray. Other hardware never gets here: with no drives besides
// the one umbrelOS runs from, it sets up on that drive.
// The photo of an empty Umbrel Pro is 1693x738. The device is the part from 50 to 1335 across and
// from 53 down to the bottom edge, where the photo cuts it off. The rest is its shadow, which falls
// to the right, so centring the photo leaves the device left of centre.
const emptyPro = {width: 1693, height: 738, left: 50, right: 1335, top: 53}

function EmptyPro() {
	const id = useId()
	const deviceWidth = emptyPro.right - emptyPro.left
	const deviceHeight = emptyPro.height - emptyPro.top
	const photo = {x: -emptyPro.left, y: -emptyPro.top, width: emptyPro.width, height: emptyPro.height}
	// The shadow fades out before the sides of the card rather than being cut by them
	const sides = 'linear-gradient(to right, transparent, black 28px, black calc(100% - 28px), transparent)'
	return (
		<div
			className='flex min-h-0 flex-1 items-center justify-center overflow-hidden px-7 py-6'
			style={{maskImage: sides, WebkitMaskImage: sides}}
		>
			{/* The drawing's own box is the device alone: that is what gets centred and fitted to the
			    room there is, and the shadow hangs outside it */}
			<svg
				viewBox={`0 0 ${deviceWidth} ${deviceHeight}`}
				className='max-h-full w-full max-w-[620px] shrink-0 overflow-visible'
				aria-hidden
			>
				<defs>
					{/* The device fades out before the straight cut at the photo's foot */}
					<linearGradient id={`${id}-fade`} x1='0' y1='0' x2='0' y2='1'>
						<stop offset='0.56' stopColor='white' />
						<stop offset='0.98' stopColor='black' />
					</linearGradient>
					<mask id={`${id}-foot`} maskUnits='userSpaceOnUse' {...photo}>
						<rect {...photo} fill={`url(#${id}-fade)`} />
					</mask>
				</defs>
				<image href='/assets/onboarding/no-ssd-found.webp' {...photo} mask={`url(#${id}-foot)`} />
			</svg>
		</div>
	)
}

export function NoDrivesStage({
	isPro,
	looking,
	onLookAgain,
	onShutdown,
}: {
	isPro: boolean
	looking?: boolean
	onLookAgain: () => void
	onShutdown: () => void
}) {
	const {t} = useTranslation()
	return (
		<div className='flex min-h-0 flex-1 flex-col md:px-2 md:pt-4'>
			<StepHeader title={t(isPro ? 'storage-setup.none.title.ssd' : 'storage-setup.none.title.drive')}>
				{t(isPro ? 'storage-setup.none.body.pro' : 'storage-setup.none.body.other')}
			</StepHeader>
			{isPro ? (
				<EmptyPro />
			) : (
				<div className='flex min-h-0 flex-1 items-center justify-center py-6'>
					<img src={hardDrive} alt='' draggable={false} className='w-[100px] opacity-25 grayscale' />
				</div>
			)}
			{/* The same footer as every other step, so the buttons are where they always are */}
			<div className='flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-white/10 pt-5'>
				<button className={secondaryButtonClasss} disabled={looking} onClick={onLookAgain}>
					{t('storage-setup.none.look-again')}
				</button>
				<button {...primaryButtonProps} onClick={onShutdown}>
					{t('shut-down')}
				</button>
			</div>
		</div>
	)
}

// umbreld says whether an earlier setup can be restored, not which drives hold it
export function EarlierSetupStage({
	isPro,
	drives,
	onRestore,
	onSetUpAsNew,
}: {
	isPro: boolean
	// The drives that were found, on other hardware
	drives?: DriveView[]
	onRestore: () => void
	// Goes on to the storage step. Nothing is erased until that step's own confirmation.
	onSetUpAsNew: () => void
}) {
	const {t} = useTranslation()
	return (
		<Centered>
			{isPro ? (
				<ProFront />
			) : (
				drives && (
					<div className='w-full max-w-[400px]'>
						<DriveBay drives={drives} mode='plain' />
					</div>
				)
			)}
			<h1 className='mt-2 text-24 font-bold text-white/90 sm:text-32' style={titleGlow}>
				{t('storage-setup.earlier.title')}
			</h1>
			<p className='max-w-[460px] text-center text-15 leading-relaxed text-white/60'>
				{t(isPro ? 'storage-setup.earlier.body.ssd' : 'storage-setup.earlier.body.drive')}
			</p>
			<div className='mt-2 flex flex-wrap justify-center gap-3'>
				<button className={secondaryButtonClasss} onClick={onSetUpAsNew}>
					{t('storage-setup.earlier.new')}
				</button>
				<button {...primaryButtonProps} onClick={onRestore}>
					{t('storage-setup.earlier.restore')}
				</button>
			</div>
		</Centered>
	)
}

// Creating the storage, or restoring an earlier setup. umbreld doesn't say how far along it
// is, and stops answering while it restarts, so the bar only moves. Past a few minutes the
// screen says it is still working instead of looking stuck.
export function WorkingStage({
	isPro,
	ssd = isPro,
	restoring,
	step,
	progress,
	waiting,
	checking,
	onCheckAgain,
	actions,
}: {
	isPro: boolean
	// The machine has nothing but SSDs, so it is told about SSDs
	ssd?: boolean
	restoring?: boolean
	// What umbreld is doing, as far as it is known
	step?: 'preparing' | 'restarting' | 'finishing'
	// 0 to 100, where it is known
	progress?: number
	// Why nothing seems to be happening
	waiting?: 'still-working' | 'connection-lost'
	checking?: boolean
	onCheckAgain?: () => void
	// More ways forward once the wait has been long: returning to the start
	actions?: React.ReactNode
}) {
	const {t: plainT} = useTranslation()
	const t = forKind(plainT, ssd ? 'ssd' : 'drive')
	const current =
		step ?? (progress === undefined || progress < 45 ? 'preparing' : progress < 78 ? 'restarting' : 'finishing')
	const line =
		current === 'preparing'
			? t(restoring ? 'storage-setup.working.finding' : 'storage-setup.working.preparing')
			: current === 'restarting'
				? t('storage-setup.working.restarting')
				: t('storage-setup.working.finishing')
	const title = t(restoring ? 'storage-setup.working.title.restore' : 'storage-setup.working.title')
	return (
		<Centered>
			{isPro && <ProFront />}
			<h1 className='text-center text-24 font-bold text-white/90 sm:text-32' style={titleGlow}>
				{title}
			</h1>
			<AnimatePresence mode='wait' initial={false}>
				<motion.p
					key={line}
					role='status'
					initial={{opacity: 0, y: 4}}
					animate={{opacity: 1, y: 0}}
					exit={{opacity: 0, y: -4}}
					transition={{duration: 0.18, ease: 'easeOut'}}
					className='text-15 text-white/60'
				>
					{line}
				</motion.p>
			</AnimatePresence>
			<div className='mt-2 flex w-full max-w-sm justify-center' aria-label={title}>
				<Progress value={progress} />
			</div>
			{waiting ? (
				<div className='mt-4 flex flex-col items-center gap-3' role='status'>
					<p className='max-w-[420px] text-center text-13 leading-relaxed text-white/50'>
						{t(waiting === 'connection-lost' ? 'storage-setup.working.connection-lost' : 'storage-setup.working.still')}
					</p>
					<div className='flex flex-wrap justify-center gap-3'>
						{onCheckAgain && (
							<button className={secondaryButtonClasss} disabled={checking} onClick={onCheckAgain}>
								{t('storage-status.check-again')}
							</button>
						)}
						{actions}
					</div>
				</div>
			) : (
				<p className='mt-4 text-center text-13 text-white/45'>{t('storage-setup.working.hint')}</p>
			)}
		</Centered>
	)
}

export function FailedStage({
	ssd,
	restoring,
	canRetry,
	detail,
	onRetry,
	onShutdown,
	onSetUpAsNew,
}: {
	// The machine has nothing but SSDs, so it is told about SSDs
	ssd?: boolean
	restoring?: boolean
	canRetry: boolean
	// umbreld's own words, for anyone who wants them
	detail?: string
	onRetry: () => void
	onShutdown: () => void
	// After a restore that failed: carry on to the storage step instead
	onSetUpAsNew?: () => void
}) {
	const {t: plainT} = useTranslation()
	const t = forKind(plainT, ssd ? 'ssd' : 'drive')
	return (
		<Centered>
			<span className='flex size-14 items-center justify-center rounded-full bg-[#F5A623]/15 text-[#F5A623]'>
				<TbAlertTriangleFilled className='size-7' />
			</span>
			<h1 className='mt-1 text-center text-24 font-bold text-white/90 sm:text-32' style={titleGlow}>
				{t(restoring ? 'storage-setup.failed.title.restore' : 'storage-setup.failed.title')}
			</h1>
			<p role='alert' className='max-w-[460px] text-center text-15 leading-relaxed text-white/60'>
				{restoring
					? t('storage-setup.failed.body.restore')
					: t(canRetry ? 'storage-setup.failed.body.retry' : 'storage-setup.failed.body.no-retry')}
			</p>
			{detail && (
				<Disclosure summary={t('storage-ui.technical-details')}>
					<code className='text-12 break-words text-white/55'>{detail}</code>
				</Disclosure>
			)}
			<div className='mt-2 flex flex-wrap justify-center gap-3'>
				<button className={secondaryButtonClasss} onClick={onShutdown}>
					{t('shut-down')}
				</button>
				{onSetUpAsNew && (
					<button className={secondaryButtonClasss} onClick={onSetUpAsNew}>
						{t('storage-setup.earlier.new')}
					</button>
				)}
				{canRetry && (
					<button {...primaryButtonProps} onClick={onRetry}>
						{t('try-again')}
					</button>
				)}
			</div>
		</Centered>
	)
}

export function DoneStage({
	isPro,
	name,
	restored,
	storage,
	launching,
	onLaunch,
	extra,
	terms,
	footer,
}: {
	isPro: boolean
	// The person's first name, when they have just given it
	name?: string
	restored?: boolean
	// What was set up
	storage?: {usable: number; kind: DriveKind; level: FailsafeLayout | null; accel: number}
	launching?: boolean
	onLaunch: () => void
	// A second action beside Launch
	extra?: React.ReactNode
	// The line that goes with the Launch button
	terms?: React.ReactNode
	// Beneath everything: a way to reach support
	footer?: React.ReactNode
}) {
	const {t} = useTranslation()
	const reduceMotion = useReducedMotion()
	return (
		<Centered>
			{isPro ? (
				<ProFront />
			) : (
				<motion.span
					initial={reduceMotion ? false : {scale: 0.6, opacity: 0}}
					animate={{scale: 1, opacity: 1}}
					transition={{type: 'spring', duration: 0.6, bounce: 0.3}}
					className='flex size-14 items-center justify-center rounded-full bg-white text-black shadow-[0_10px_30px_-8px_rgba(255,255,255,0.6)]'
				>
					<TbCheck className='size-8' strokeWidth={3} />
				</motion.span>
			)}
			<h1 className='mt-1 text-center text-24 font-bold text-white/90 sm:text-32' style={titleGlow}>
				{name ? t('onboarding.account-created.youre-all-set-name', {name}) : t('storage-setup.done.title')}
			</h1>
			{restored ? (
				<p className='max-w-[420px] text-center text-15 text-white/60'>{t('storage-setup.done.restored')}</p>
			) : (
				storage && (
					<div className='flex flex-col items-center gap-2.5'>
						<p className='text-15 text-white/60'>
							{t(storage.accel > 0 ? 'storage-setup.done.storage-accel' : 'storage-setup.done.storage', {
								size: formatSize(storage.usable),
							})}
						</p>
						<span className='flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-13 text-white/85'>
							{storage.level ? (
								<>
									<IoShieldHalf className='size-3.5 text-white' />
									{t('storage-ui.failsafe')}
								</>
							) : (
								<>
									<TbServer className='size-3.5' />
									{t('storage-ui.full-storage')}
								</>
							)}
						</span>
					</div>
				)
			)}
			{terms}
			<div className='mt-3 flex flex-wrap justify-center gap-3'>
				{extra}
				<button {...primaryButtonProps} disabled={launching} onClick={onLaunch}>
					{launching ? t('onboarding.raid.launching') : t('onboarding.launch-umbrelos')}
				</button>
			</div>
			{footer && <div className='mt-4'>{footer}</div>}
		</Centered>
	)
}
