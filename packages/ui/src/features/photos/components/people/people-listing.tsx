import {ChevronDown} from 'lucide-react'
import {useState} from 'react'
import {useTranslation} from 'react-i18next'
import {TbLoader} from 'react-icons/tb'
import {useNavigate} from 'react-router-dom'

import {PillButton} from '@/components/ui/edge-controls'
import {Progress} from '@/components/ui/progress'
import {useScrollMemory} from '@/features/photos/components/collections/use-scroll-memory'
import {FadedScroller} from '@/features/photos/components/listing/faded-scroller'
import {ListingSurface, type Frame} from '@/features/photos/components/listing/surface'
import {PersonCard} from '@/features/photos/components/people/person-card'
import {PersonSuggestionCard} from '@/features/photos/components/people/person-suggestion'
import {usePhotosSelection} from '@/features/photos/components/selection-context'
import {personPath} from '@/features/photos/constants'
import {usePeople, usePersonSuggestions, type Person} from '@/features/photos/hooks/use-people'
import {useSearchStatus} from '@/features/photos/hooks/use-search'
import type {SearchWork} from '@/features/search/status'
import {useSearchWork} from '@/features/search/use-search-footnote'
import {cn} from '@/lib/utils'
import {DockSpacer} from '@/modules/desktop/dock'
import {formatNumberI18n} from '@/utils/number'
import {tw} from '@/utils/tw'

// Faces a little larger than a default tile: a person is recognised by their
// face, and a small circle of one is a guess. Side room so a card lifting on
// hover isn't clipped at the scroller's edges.
const gridClass = tw`grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-x-4 gap-y-6 px-2 md:grid-cols-[repeat(auto-fill,minmax(132px,1fr))] md:gap-x-6 md:gap-y-7 xl:grid-cols-[repeat(auto-fill,minmax(148px,1fr))]`

// Everyone Photos has recognised, people with names first, then the faces
// seen most. Hidden people wait on a shelf at the end — out of the way,
// never out of reach. Above them, one question at a time, the likeliest
// first: "Is this also Anna?" — kept out of the way while people are being
// selected.
export function PeopleListing() {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const selection = usePhotosSelection()
	const visible = usePeople()
	const hidden = usePeople({hidden: true})
	const {suggestions, answered, dismiss} = usePersonSuggestions()
	const [suggestion] = suggestions
	const [showHidden, setShowHidden] = useState(false)
	const scrollerRef = useScrollMemory('people', !visible.isLoading)
	const none = visible.people.length === 0 && hidden.people.length === 0
	// How far along finding faces is, while it is under way: this page is where
	// that is said, once, whether or not anyone has been found yet
	const {data: status} = useSearchStatus()
	const finding = useSearchWork('people', status)
	// Photos being gathered for an album follow the user here, and a cover
	// being chosen passes through: neither is people being selected, and a
	// face stays the way to that person's photos
	const selectingPeople = selection.selecting && !selection.pickingFor && !selection.coveringFor

	const card = (person: Person) => (
		<PersonCard
			key={person.id}
			person={person}
			// Hidden people aren't merged or hidden again: selection is the visible grid's
			selecting={selectingPeople && !person.isHidden}
			selected={selection.ids.has(person.id)}
			onOpen={() => navigate(personPath(person.id))}
			onToggle={() => selection.toggle(person.id)}
		/>
	)

	return (
		<ListingSurface>
			{(frame) =>
				visible.isLoading ? (
					<div className='flex h-full items-center justify-center' style={{paddingTop: frame.inset}}>
						<TbLoader className='size-6 animate-spin opacity-50 shadow-xs' />
					</div>
				) : none && visible.isError ? (
					<LoadFailed frame={frame} onRetry={() => void visible.refetch()} />
				) : none ? (
					<NoPeople frame={frame} finding={finding} />
				) : (
					<FadedScroller ref={scrollerRef} frame={frame}>
						<div style={{paddingTop: frame.inset + 6}}>
							{/* Above the people found so far: how far along finding them
							    is comes first, and they move up into its place when it goes */}
							{finding && <FindingFaces work={finding} className='mx-auto mb-8' />}
							{suggestion && !selection.selecting && (
								<div className='mb-6 px-2'>
									<PersonSuggestionCard
										key={suggestion.candidate.id}
										suggestion={suggestion}
										onDismiss={dismiss}
										onAnswered={answered}
									/>
								</div>
							)}
							<div className={gridClass}>{visible.people.map(card)}</div>
						</div>
						{hidden.people.length > 0 && (
							<section className='mt-10 px-2'>
								<button
									type='button'
									aria-expanded={showHidden}
									onClick={() => setShowHidden((shown) => !shown)}
									className='-ml-2 flex items-center gap-1 rounded-lg px-2 py-1 text-12 font-medium text-white/40 transition-colors hover:text-white/70'
								>
									{t('photos-people.hidden', {count: hidden.people.length})}
									<ChevronDown
										className={cn(
											'size-3.5 transition-transform duration-200 motion-reduce:transition-none',
											showHidden && 'rotate-180',
										)}
									/>
								</button>
								{showHidden && (
									<div
										className={cn(
											gridClass,
											'mt-4 px-0 motion-safe:animate-in motion-safe:duration-200 motion-safe:fade-in motion-safe:slide-in-from-top-1',
										)}
									>
										{hidden.people.map(card)}
									</div>
								)}
							</section>
						)}
						{/* Room at the end: for the last row to clear the dock the surface runs beneath */}
						<DockSpacer />
					</FadedScroller>
				)
			}
		</ListingSurface>
	)
}

// How many of the library's photos and videos have been looked through for
// faces: a hairline of it, and the count under it. The bar carries the words
// for a screen reader, which is not read them again from the line.
function FindingFaces({work, className}: {work: SearchWork; className?: string}) {
	const {t, i18n} = useTranslation()
	const format = (n: number) => formatNumberI18n({n, showDecimals: false, locale: i18n.language})
	const percent = new Intl.NumberFormat(i18n.language, {style: 'percent'}).format(work.percent / 100)
	const label = t('photos-people.finding-faces', {
		completed: format(work.completed),
		total: format(work.total),
		percent,
	})
	return (
		<div className={cn('flex w-52 max-w-full flex-col items-center gap-2', className)}>
			<Progress
				value={work.percent}
				aria-label={label}
				className='h-1 bg-white/8 [&>div]:bg-white/60 [&>div]:duration-500 [&>div]:ease-out [&>div]:motion-reduce:transition-none'
			/>
			<p aria-hidden className='text-center text-12 text-white/40 tabular-nums'>
				{label}
			</p>
		</div>
	)
}

// Nobody yet. Faces are found as Search reads the library, so on a new
// library this page is simply early: say so, and show how far along the
// finding is while it runs. Three empty circles stand where the faces will.
function NoPeople({frame, finding}: {frame: Frame; finding: SearchWork | null}) {
	const {t} = useTranslation()
	const {data: status} = useSearchStatus()
	// Only a device that cannot run the models never will have faces: a list
	// that could not be fetched is another screen (LoadFailed)
	const unsupported = status?.reason === 'unsupported-device'

	return (
		<div
			className='flex h-full flex-col items-center justify-center gap-1 p-6 text-center'
			style={{paddingTop: frame.inset}}
		>
			<div aria-hidden className='mb-4 flex items-end -space-x-3'>
				<span className='size-12 rounded-full bg-white/[0.035] ring-1 ring-white/6 ring-inset' />
				<span className='z-10 size-16 rounded-full bg-white/[0.06] ring-1 ring-white/8 backdrop-blur-sm ring-inset' />
				<span className='size-12 rounded-full bg-white/[0.035] ring-1 ring-white/6 ring-inset' />
			</div>
			<p className='text-15 font-medium text-white/80'>{t('photos-people.empty-title')}</p>
			<p className='max-w-sm text-13 text-white/50'>
				{unsupported
					? t('photos-people.empty-unsupported')
					: status?.reason === 'starting'
						? t('photos-people.empty-starting')
						: t('photos-people.empty-description')}
			</p>
			{finding && <FindingFaces work={finding} className='mt-4' />}
		</div>
	)
}

// The list could not be fetched. That says nothing about the people in it,
// so it claims nothing about them: only that it failed, and a way to ask again.
function LoadFailed({frame, onRetry}: {frame: Frame; onRetry: () => void}) {
	const {t} = useTranslation()
	return (
		<div
			className='flex h-full flex-col items-center justify-center gap-1 p-6 text-center'
			style={{paddingTop: frame.inset}}
		>
			<p className='text-15 font-medium text-white/80'>{t('photos-people.load-failed-title')}</p>
			<p className='max-w-sm text-13 text-white/50'>{t('photos-people.load-failed-description')}</p>
			<div className='mt-3'>
				<PillButton className='backdrop-blur-sm' onClick={onRetry}>
					{t('try-again')}
				</PillButton>
			</div>
		</div>
	)
}
