import {useTranslation} from 'react-i18next'

import {ProgressRing} from '@/components/ui/progress-ring'
import {cn} from '@/lib/utils'

// Beside what is typed, how far along the work its answers rest on is: the
// ring the Photos sidebar draws for media being prepared, here for a library
// still being read (Files speaks of files, as its line does). `percent` is a
// search footnote's (see useSearchFootnote), and without one there is nothing
// to draw. It announces nothing as it fills. Its value is the percentage, so
// its name leaves the number out, and the words a pointer resting on it is
// shown, number and all, are kept from being read out after it.
export function SearchArc({
	percent,
	files = false,
	className,
}: {
	percent: number | undefined
	files?: boolean
	className?: string
}) {
	const {t, i18n} = useTranslation()
	if (percent === undefined) return null
	const formatted = new Intl.NumberFormat(i18n.language, {style: 'percent'}).format(percent / 100)
	return (
		<span
			role='progressbar'
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={percent}
			aria-label={files ? t('search.analyzing-label.files') : t('search.analyzing-label.library')}
			className={cn(
				'flex size-3.5 shrink-0 motion-safe:animate-in motion-safe:duration-300 motion-safe:fade-in',
				className,
			)}
		>
			<span
				aria-hidden
				title={
					files
						? t('search.analyzing-progress.files', {percent: formatted})
						: t('search.analyzing-progress.library', {percent: formatted})
				}
				className='flex size-full'
			>
				<ProgressRing fraction={percent / 100} className='size-full [&_circle]:motion-reduce:transition-none' />
			</span>
		</span>
	)
}
