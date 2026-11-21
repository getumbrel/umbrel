// Full-screen covers: what umbrelOS puts over everything else while it updates, migrates,
// restores, restarts, shuts down or resets, and when the device can't be reached.
//
// Every cover is the same quiet column, top to bottom: a mark, a title, how far along it is,
// the fine print, and what can be done. The mark and the title sit at the same place on every
// cover and the rest grows downwards from them, so nothing moves when one cover follows
// another. A cover only shows what it is given: the caller owns the words and the numbers.
//
// The mark and the surface say where umbrelOS is before a word is read:
// - the logo on the wallpaper: umbrelOS is at work
// - the logo dimmed on black: umbrelOS is away (shut down, or not answering)
// - a warning: something failed, and it's the person's turn

import * as ProgressPrimitive from '@radix-ui/react-progress'
import {ChevronDown, ChevronUp} from 'lucide-react'
import {useEffect, useId, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {TbAlertCircle} from 'react-icons/tb'

import {Button} from '@/components/ui/button'
import {CoverMessageContent} from '@/components/ui/cover-message'
import {Spinner} from '@/components/ui/loading'
import {dialogFooterClass} from '@/components/ui/shared/dialog'
import UmbrelLogo from '@/components/umbrel-logo'
import {cn} from '@/lib/utils'
import {Wallpaper} from '@/providers/wallpaper'

type Surface = 'wallpaper' | 'black'

export type CoverProps = {
	/**
	 * What the cover sits on. The wallpaper needs the wallpaper provider above it. Black needs
	 * nothing, so it also works where no provider can be relied on.
	 */
	surface?: Surface
	mark?: 'logo' | 'logo-dimmed' | 'warning'
	title: string
	/** What happened or what is going on, when the title can't say it all */
	description?: React.ReactNode
	/**
	 * How far along it is. 0 to 100 fills a bar, and 'indeterminate' keeps the bar going while a
	 * task that reports an amount has none yet. 'spinner' is for work that never reports one
	 * (restarting, shutting down). Left out, there is neither.
	 */
	progress?: number | 'indeterminate' | 'spinner'
	/** One line under the bar or the spinner: the step, how much is done, the time left */
	status?: string
	/** The fine print: what not to do meanwhile */
	note?: React.ReactNode
	/** Buttons, the primary one first (see dialogFooterClass) */
	actions?: React.ReactNode
	/** The error as it was reported, kept behind "Show details" */
	details?: string
	/**
	 * Draws the cover where it is rendered instead of in the cover target. For the last-resort
	 * screens that replace the tree the target lives in, where the target is gone by the time the
	 * cover would land in it.
	 */
	standalone?: boolean
}

export function Cover({
	surface = 'wallpaper',
	mark = 'logo',
	title,
	description,
	progress,
	status,
	note,
	actions,
	details,
	standalone,
}: CoverProps) {
	return (
		<CoverSurface surface={surface} standalone={standalone}>
			{/* Scrolls rather than clips when a phone on its side can't fit a long message */}
			<div className='fixed inset-0 z-50 overflow-y-auto'>
				<div className='flex h-full flex-col items-center pr-[calc(24px+var(--safe-right))] pl-[calc(24px+var(--safe-left))]'>
					{/* Sets a cover with everything on it (a title, a bar, a status and two lines of fine
					    print: 212px) a little above the middle of the screen, where it looks centred. Every
					    cover starts at that height, so the shorter ones sit higher rather than lower. It
					    gives way before anything has to scroll. */}
					<div className='min-h-[calc(40px+var(--safe-top))] shrink basis-[calc(48dvh-106px)]' />
					<div className='flex w-full max-w-[340px] shrink-0 animate-in flex-col items-center text-center duration-700 fill-mode-both fade-in'>
						{/* One box for every mark keeps the title where it is */}
						<div className='flex h-11 items-center justify-center'>
							{mark === 'logo' && <UmbrelLogo className='w-22 text-white/90' aria-hidden='true' />}
							{mark === 'logo-dimmed' && <UmbrelLogo className='w-22 text-white/30' aria-hidden='true' />}
							{/* The glyph keeps air around its circle, so it is drawn larger than the box for the
							    circle itself to stand about as tall as the logo */}
							{mark === 'warning' && (
								<TbAlertCircle className='size-13 shrink-0 text-white/90' strokeWidth={1.75} aria-hidden='true' />
							)}
						</div>
						<h1 className='mt-6 text-19 leading-tight font-semibold -tracking-2 text-balance break-words'>{title}</h1>
						{description && (
							<p className='mt-2 text-14 leading-snug text-balance break-words text-white/60'>{description}</p>
						)}
						{progress === 'spinner' ? (
							<div role='progressbar' aria-label={title} aria-valuetext={status} className='mt-6 flex [&>svg]:size-6'>
								<Spinner />
							</div>
						) : (
							progress !== undefined && <CoverBar value={progress} label={title} valueText={status} />
						)}
						{status && (
							<p className='mt-3 text-13 leading-tight text-balance break-words text-white/70 tabular-nums'>{status}</p>
						)}
						{note && <p className='mt-7 text-13 leading-snug text-balance break-words text-white/50'>{note}</p>}
						{/* As wide as the bar on a phone, so the column keeps one width */}
						{actions && (
							<div className={cn(dialogFooterClass, 'mt-7 w-60 max-w-full md:w-auto md:justify-center')}>{actions}</div>
						)}
						{details && <CoverDetails>{details}</CoverDetails>}
					</div>
					<div className='min-h-10 shrink-0 grow' />
				</div>
			</div>
		</CoverSurface>
	)
}

// The bar. It crossfades between measuring and not, in both directions: an update starts with
// nothing to measure, counts up, then restarts the device with nothing to measure again.
function CoverBar({value, label, valueText}: {value: number | 'indeterminate'; label: string; valueText?: string}) {
	const measured = value !== 'indeterminate'
	const percent = measured ? Math.min(Math.max(value, 0), 100) : null
	// The last amount, kept while there is nothing to measure, so the fill fades out where it
	// stood instead of emptying
	const [amount, setAmount] = useState(0)
	if (percent !== null && percent !== amount) setAmount(percent)

	return (
		<ProgressPrimitive.Root
			value={percent}
			aria-label={label}
			aria-valuetext={valueText}
			className='relative mt-6 h-1 w-60 max-w-full overflow-hidden rounded-full bg-white/15'
		>
			{/* A soft light that glides from end to end and back: at work, with nothing to measure.
			    Without motion it rests in the middle, where it can't be read as an amount. */}
			<div
				className={cn(
					'absolute inset-y-0 left-0 w-1/2 animate-cover-glide bg-linear-to-r from-transparent via-white/90 to-transparent transition-opacity duration-500 motion-reduce:translate-x-1/2 motion-reduce:animate-none',
					measured && 'opacity-0 [animation-play-state:paused]',
				)}
			/>
			<ProgressPrimitive.Indicator
				className={cn(
					'absolute inset-y-0 left-0 rounded-full bg-white/90 transition-[width,opacity] duration-700 ease-out motion-reduce:transition-none',
					!measured && 'opacity-0',
				)}
				style={{width: `${amount}%`}}
			/>
		</ProgressPrimitive.Root>
	)
}

/**
 * The buttons of a cover for work that failed: the way to try again, then the way out. Home is a
 * plain link, so leaving reloads umbrelOS and it starts over from what the device reports.
 */
export function CoverRetryActions({retry, onRetry}: {retry: string; onRetry: () => void}) {
	const {t} = useTranslation()
	return (
		<>
			<Button size='dialog' variant='secondary' onClick={onRetry}>
				{retry}
			</Button>
			<Button asChild size='dialog' variant='default'>
				{/* A button's label is drawn with the browser's own text rendering, not the page's, and
				    its optical centring is tuned for that: the same here, so the two labels share a line */}
				<a href='/' className='[text-rendering:auto]'>
					{t('not-found-404.home')}
				</a>
			</Button>
		</>
	)
}

/**
 * The cover for a wait that usually passes in a blink: nothing at first, then a spinner.
 * The label is for screen readers.
 */
export function LoadingCover({label}: {label?: string}) {
	const {t} = useTranslation()
	const show = useDelayedShow(600)
	return (
		<CoverSurface surface='black'>
			<div className='fixed inset-0 z-50 flex items-center justify-center'>
				{show && (
					<div role='status' aria-label={label ?? t('loading')} className='animate-in duration-700 fade-in'>
						<Spinner />
					</div>
				)}
			</div>
		</CoverSurface>
	)
}

function CoverSurface({
	surface,
	standalone,
	children,
}: {
	surface: Surface
	standalone?: boolean
	children: React.ReactNode
}) {
	const layers = (
		<>
			{surface === 'wallpaper' ? (
				<>
					<Wallpaper className='z-50' stayBlurred />
					{/* Dark enough for the fine print over the brightest wallpaper, and darkest behind the
					    words themselves, so the wallpaper keeps some of its colour towards the edges */}
					<div className='fixed inset-0 z-50 animate-in bg-black/70 bg-radial-[closest-side] from-black/50 to-transparent duration-700 fade-in contrast-more:bg-black' />
				</>
			) : (
				<div className='fixed inset-0 z-50 bg-black' />
			)}
			{children}
		</>
	)
	return standalone ? layers : <CoverMessageContent>{layers}</CoverMessageContent>
}

function CoverDetails({children}: {children: string}) {
	const {t} = useTranslation()
	const [open, setOpen] = useState(false)
	const id = useId()
	const Chevron = open ? ChevronUp : ChevronDown
	return (
		<>
			<button
				type='button'
				aria-expanded={open}
				aria-controls={id}
				onClick={() => setOpen((value) => !value)}
				className='mt-5 flex items-center gap-0.5 rounded-full px-2 py-1 text-12 text-white/45 outline-hidden transition-colors hover:text-white/70 focus-visible:ring-3 focus-visible:ring-white/20'
			>
				{open ? t('hide-details') : t('show-details')}
				<Chevron className='size-3' aria-hidden='true' />
			</button>
			{open && (
				<p
					id={id}
					className='mt-1 max-h-40 w-full overflow-y-auto text-12 leading-snug break-words text-white/45 select-text'
				>
					{children}
				</p>
			)}
		</>
	)
}

function useDelayedShow(ms: number) {
	const [show, setShow] = useState(false)
	useEffect(() => {
		const id = setTimeout(() => setShow(true), ms)
		return () => clearTimeout(id)
	}, [ms])
	return show
}
