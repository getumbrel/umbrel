import {Check, EyeOff, Merge} from 'lucide-react'
import {useTranslation} from 'react-i18next'

import {PillButton} from '@/components/ui/edge-controls'
import {toast} from '@/components/ui/toast'
import {useConfirmMerge} from '@/features/photos/components/people/use-confirm-merge'
import {usePhotosSelection} from '@/features/photos/components/selection-context'
import {mergeTarget, usePeople, usePeopleActions} from '@/features/photos/hooks/use-people'
import {useBreakpoint} from '@/utils/tw'

// What the actions bar offers while people are selected on the People page:
// merge them into one — the same person recognised more than once — or hide
// them. A merge asks first (see useConfirmMerge) and says who survives: the
// one with a name, else whoever is in the most photos.
export function PeopleSelectionActions() {
	const {t} = useTranslation()
	const confirmMerge = useConfirmMerge()
	const breakpoint = useBreakpoint()
	const phone = breakpoint === 'sm'
	const {ids, done} = usePhotosSelection()
	const {people} = usePeople()
	const {mergePeople, setPersonHidden} = usePeopleActions()
	const selected = people.filter((person) => ids.has(person.id))
	const failed = () => toast.error(t('photos-selection.failed'), {area: 'photos'})

	const merge = async () => {
		const into = mergeTarget(selected)
		if (!into || selected.length < 2) return
		if (!(await confirmMerge(selected.length, into))) return
		mergePeople({into: into.id, ids: selected.filter((person) => person !== into).map((person) => person.id)})
			.then(done)
			.catch(failed)
	}
	const hide = () =>
		Promise.all(selected.map((person) => setPersonHidden({id: person.id, hidden: true})))
			.then(done)
			.catch(failed)

	return (
		<>
			<PillButton
				icon={Merge}
				disabled={selected.length < 2}
				onClick={merge}
				aria-label={phone ? t('photos-people.merge') : undefined}
			>
				{phone ? null : t('photos-people.merge')}
			</PillButton>
			<PillButton
				icon={EyeOff}
				disabled={selected.length === 0}
				onClick={hide}
				aria-label={phone ? t('photos-people.hide') : undefined}
			>
				{phone ? null : t('photos-people.hide')}
			</PillButton>
			{phone ? (
				<PillButton icon={Check} aria-label={t('done')} onClick={done} />
			) : (
				<PillButton icon={Check} onClick={done}>
					{t('done')}
				</PillButton>
			)}
		</>
	)
}
