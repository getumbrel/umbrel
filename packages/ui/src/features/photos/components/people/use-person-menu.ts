import {useTranslation} from 'react-i18next'

import {toast} from '@/components/ui/toast'
import {usePhotosSelection} from '@/features/photos/components/selection-context'
import {usePeopleActions, type Person} from '@/features/photos/hooks/use-people'

export type PersonMenuItem = {key: string; label: string; onSelect: () => void}

// What can be done with one person, wherever their menu is opened — a card's
// right-click or long press, its ⋯ button. Rename is the caller's: the name is edited in
// place, wherever the caller shows it.
export function usePersonMenu(person: Person, {onRename}: {onRename: () => void}): PersonMenuItem[] {
	const {t} = useTranslation()
	const selection = usePhotosSelection()
	const {setPersonHidden} = usePeopleActions()
	const failed = () => toast.error(t('photos-selection.failed'), {area: 'photos'})
	// While photos are being gathered for an album the selection is theirs:
	// merging and choosing a cover would each take it over
	const gathering = selection.pickingFor !== undefined

	if (person.isHidden)
		return [
			{
				key: 'unhide',
				label: t('photos-people.unhide'),
				onSelect: () => void setPersonHidden({id: person.id, hidden: false}).catch(failed),
			},
		]
	return [
		{key: 'rename', label: person.name ? t('photos-people.rename') : t('photos-people.add-name'), onSelect: onRename},
		...(gathering
			? []
			: [
					// Merging is choosing who else this is: the grid's selection, begun with this person
					{key: 'merge', label: t('photos-people.merge-ellipsis'), onSelect: () => selection.set([person.id])},
					{
						key: 'cover',
						label: t('photos-album.change-cover'),
						onSelect: () => selection.coverFor({kind: 'person', id: person.id}),
					},
				]),
		{
			key: 'hide',
			label: t('photos-people.hide'),
			onSelect: () => void setPersonHidden({id: person.id, hidden: true}).catch(failed),
		},
	]
}
