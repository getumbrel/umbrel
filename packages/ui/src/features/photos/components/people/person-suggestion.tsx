import {useTranslation} from 'react-i18next'
import {useNavigate} from 'react-router-dom'

import {toast} from '@/components/ui/toast'
import {PersonAvatar} from '@/features/photos/components/people/person-avatar'
import {useConfirmMerge} from '@/features/photos/components/people/use-confirm-merge'
import {personPath} from '@/features/photos/constants'
import {usePeopleActions, type PersonSuggestion} from '@/features/photos/hooks/use-people'
import {formatNumberI18n} from '@/utils/number'

// "Is this also Anna?", at the head of the People grid: a few faces of
// someone unnamed whom recognition takes for Anna seen at another age or
// from another side, and two answers. Recognition only ever asks — siblings
// look alike, and two people made one can't be told apart again — so yes
// is the user's merge, asked once more like every merge, and no is
// remembered for good — and the next question takes this one's place under
// the pointer, so the second click of a double click is not an answer to it.
// The faces open the person's photos, for a closer look before answering.
export function PersonSuggestionCard({
	suggestion,
	onDismiss,
	onAnswered,
}: {
	suggestion: PersonSuggestion
	onDismiss: (input: {id: string; candidateId: string}) => Promise<unknown>
	// Takes the question off the list as soon as it is answered
	onAnswered: (candidateId: string) => void
}) {
	const {t, i18n} = useTranslation()
	const navigate = useNavigate()
	const {mergePeople} = usePeopleActions()
	const confirmMerge = useConfirmMerge()
	const {person, candidate} = suggestion
	const title = t('photos-people.suggestion-title', {name: person.name})
	const count = t('photos-collections.count', {
		count: candidate.count,
		formattedCount: formatNumberI18n({n: candidate.count, showDecimals: false, locale: i18n.language}),
	})
	const failed = () => toast.error(t('photos-selection.failed'), {area: 'photos'})

	const yes = async () => {
		if (!(await confirmMerge(2, person))) return
		onAnswered(candidate.id)
		mergePeople({into: person.id, ids: [candidate.id]}).catch(failed)
	}
	const no = () => onDismiss({id: person.id, candidateId: candidate.id}).catch(failed)

	return (
		<section
			aria-label={title}
			className='flex items-center gap-3 rounded-2xl bg-white/[0.04] py-2.5 pr-2.5 pl-3 ring-1 ring-white/8 ring-inset motion-safe:animate-in motion-safe:duration-300 motion-safe:fade-in motion-safe:slide-in-from-top-1 max-md:flex-wrap'
		>
			<button
				type='button'
				onClick={() => navigate(personPath(candidate.id))}
				aria-label={t('photos-people.suggestion-review')}
				className='flex shrink-0 -space-x-2.5 rounded-full outline-hidden focus-visible:ring-2 focus-visible:ring-white/60'
			>
				{candidate.faces.slice(0, 3).map((face, index) => (
					<PersonAvatar
						// By place: two of the faces can be in one photo
						key={index}
						person={{cover: face}}
						size={36}
						className='shadow-[0_0_0_2px_rgb(0_0_0/0.45)]'
					/>
				))}
			</button>
			<div className='min-w-0 flex-1'>
				<p className='truncate text-13 font-medium text-white/90'>{title}</p>
				<p className='text-12 text-white/45 tabular-nums'>{count}</p>
			</div>
			<div className='flex shrink-0 items-center gap-1.5 max-md:ml-auto'>
				<button
					type='button'
					onClick={yes}
					className='rounded-full bg-white/90 px-3 py-1 text-12 font-medium text-black transition-colors hover:bg-white'
				>
					{t('photos-people.suggestion-yes')}
				</button>
				<button
					type='button'
					// (A click's `detail` is its place in a run of clicks; 0 from the keyboard)
					onClick={(event) => {
						if (event.detail <= 1) no()
					}}
					className='rounded-full bg-white/10 px-3 py-1 text-12 font-medium text-white/80 transition-colors hover:bg-white/15'
				>
					{t('photos-people.suggestion-no')}
				</button>
			</div>
		</section>
	)
}
