import {Info, X} from 'lucide-react'
import {useState, type ReactNode} from 'react'
import {useTranslation} from 'react-i18next'
import {TbLoader} from 'react-icons/tb'
import {useMedia} from 'react-use'

import {floatingGlassClass} from '@/features/files/components/file-viewer/shell/zoom-pill'
import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import type {FileSystemItem} from '@/features/files/types'
import {cn} from '@/lib/utils'
import {useAuthorizedHttpUrl} from '@/modules/auth/http-auth'
import {touchTargetClass} from '@/utils/element-classes'
import {tw} from '@/utils/tw'

export const stageButtonClass = tw`umbrel-button inline-flex h-[30px] items-center rounded-full border-[0.5px] border-white/20 bg-white/10 px-4 text-13 font-medium text-white/90 shadow-button-highlight-soft-hpx transition-all duration-300 hover:bg-white/15 active:scale-[0.97] active:bg-white/6`

// While a file is on its way: its icon, never an empty stage. The spinner
// only joins after a beat, so a quick open doesn't flash it.
export function StageLoading({item}: {item: FileSystemItem}) {
	return (
		<div className='flex flex-1 flex-col items-center justify-center gap-5'>
			<FileItemIcon item={item} className='size-16 opacity-90' showBadges={false} />
			{/* Fading in and spinning are both an element's animation, so each has its own */}
			<span className='flex motion-safe:animate-in motion-safe:duration-300 motion-safe:fill-mode-backwards motion-safe:[animation-delay:400ms] motion-safe:fade-in'>
				<TbLoader className='size-5 animate-spin text-white/40' />
			</span>
		</div>
	)
}

// Why a file can't be shown, and what can be done instead
export function StageMessage({
	item,
	title,
	detail,
	children,
	className,
}: {
	item: FileSystemItem
	title: string
	detail: string
	children?: ReactNode
	className?: string
}) {
	return (
		<div className={cn('flex flex-1 items-center justify-center p-4', className)}>
			<div className='flex w-full max-w-[380px] flex-col items-center gap-5 rounded-20 bg-dialog-content/70 p-8 text-center shadow-dialog backdrop-blur-2xl contrast-more:bg-dialog-content contrast-more:backdrop-blur-none'>
				<FileItemIcon item={item} className='size-14' showBadges={false} />
				<div className='min-w-0'>
					<h3 className='text-15 font-semibold -tracking-2 break-words text-white/90'>{title}</h3>
					<p className='mt-1.5 text-13 text-white/40'>{detail}</p>
				</div>
				{children && <div className='flex flex-wrap justify-center gap-2'>{children}</div>}
			</div>
		</div>
	)
}

// The way on from a file a viewer can't show: downloading it
export function StageDownload({item}: {item: FileSystemItem}) {
	const {t} = useTranslation()
	const url = useAuthorizedHttpUrl(`/api/files/download?path=${encodeURIComponent(item.path)}`)
	if (!url) return null
	return (
		<a href={url} download={item.name} className={stageButtonClass}>
			{t('files-viewer.download')}
		</a>
	)
}

// A phone on its side, with no height to spare for anything above the stage: a notice, the edit hint, a filmstrip
export const useShortScreen = () => useMedia('(max-height: 500px)')

// What a viewer draws only roughly, named for its notice, in the order the notice lists them
const APPROXIMATED = {
	charts: 'files-viewer.notice-charts',
	comments: 'files-viewer.notice-comments',
	diagrams: 'files-viewer.notice-diagrams',
	drawings: 'files-viewer.notice-drawings',
	equations: 'files-viewer.notice-equations',
	formatting: 'files-viewer.notice-formatting',
	media: 'files-viewer.notice-media',
	objects: 'files-viewer.notice-objects',
	pictures: 'files-viewer.notice-pictures',
}

// "Charts and media can't be shown fully here…", for the notice, when a file has any of them
export function useApproximationNotice(approximated: ReadonlySet<keyof typeof APPROXIMATED>, editable: boolean) {
	const {t, i18n} = useTranslation()
	const kinds = new Intl.ListFormat(i18n.language).format(
		(Object.keys(APPROXIMATED) as (keyof typeof APPROXIMATED)[])
			.filter((kind) => approximated.has(kind))
			.map((kind) => t(APPROXIMATED[kind])),
	)
	return (
		kinds &&
		t(editable ? 'files-viewer.notice' : 'files-viewer.notice-read-only', {
			list: kinds[0].toLocaleUpperCase(i18n.language) + kinds.slice(1),
		})
	)
}

// Where a notice or the edit hint floats: across the top of the stage, letting presses through around it
export const stageTopClass = tw`pointer-events-none absolute inset-x-3 top-3 z-10 flex justify-center`

// What a viewer leaves out (charts, embedded media), said once and calmly,
// over the top of its stage: it stays in the file, and a save leaves it be
export function StageNotice({children}: {children: ReactNode}) {
	const {t} = useTranslation()
	const [dismissed, setDismissed] = useState(false)
	if (dismissed) return null
	return (
		<div className={stageTopClass}>
			<div
				role='status'
				className={cn(
					floatingGlassClass,
					'pointer-events-auto flex max-w-md items-center gap-2.5 rounded-2xl py-1.5 pr-1.5 pl-3.5 text-12 leading-snug text-white/80 motion-safe:animate-in motion-safe:duration-300 motion-safe:fill-mode-backwards motion-safe:[animation-delay:600ms] motion-safe:fade-in motion-safe:slide-in-from-top-1',
				)}
			>
				<Info className='size-4 shrink-0 text-white/45' />
				<p className='min-w-0 py-1 text-balance'>{children}</p>
				<button
					type='button'
					aria-label={t('files-viewer.dismiss')}
					onClick={() => setDismissed(true)}
					className={cn(
						touchTargetClass,
						'flex size-7 shrink-0 items-center justify-center rounded-full text-white/55 transition-colors hover:bg-white/10 hover:text-white focus-visible:bg-white/10 focus-visible:outline-hidden',
					)}
				>
					<X className='size-3.5' />
				</button>
			</div>
		</div>
	)
}
