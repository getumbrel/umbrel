import {useTranslation} from 'react-i18next'
import {TbLoader} from 'react-icons/tb'

import {ProgressRing} from '@/components/ui/progress-ring'
import {useLibraryStatus} from '@/features/photos/hooks/use-library'
import type {RouterOutput} from '@/trpc/trpc'

type LibraryStatus = RouterOutput['photos']['library']['status']

// Above this the ring reads as full and looks stuck while the tail of the
// queue drains, so it hands over to an indeterminate spinner
const RING_MAX_PERCENTAGE = 95

export type IndicatorState = {kind: 'spinner'; percentage: number} | {kind: 'ring'; percentage: number} | null

// Only enrichment shows here: a filling ring while the number is meaningful,
// a spinner for the crawl at the very end. Indexing already has the
// timeline's full-screen state and a degraded library speaks through the
// timeline's footer — neither needs a sidebar echo.
export function indicatorState(status: LibraryStatus | undefined): IndicatorState {
	if (status?.phase !== 'enriching') return null
	if (status.percentage > RING_MAX_PERCENTAGE) return {kind: 'spinner', percentage: status.percentage}
	return {kind: 'ring', percentage: status.percentage}
}

// The Library row's quiet signal that media is still being prepared: a
// filling progress ring, or a spinner when there's no meaningful number to
// draw. Its own component so the percentage stream re-renders only this,
// not the whole sidebar.
export function EnrichmentIndicator() {
	const {t} = useTranslation()
	const {data: status} = useLibraryStatus()
	const state = indicatorState(status)
	if (!state) return null

	const label = t('photos-sidebar.preparing', {percentage: Math.floor(state.percentage)})
	return (
		<span role='status' aria-label={label} title={label} className='flex size-3.5 shrink-0'>
			{state.kind === 'spinner' ? (
				// The app's spinner, as the indexing and loading screens draw it
				<TbLoader className='size-full animate-spin text-white/70' />
			) : (
				<ProgressRing fraction={state.percentage / 100} />
			)}
		</span>
	)
}
