import {useEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'

import {Popover, PopoverAnchor, PopoverContent} from '@/components/ui/popover'
import {toast} from '@/components/ui/toast'
import {PersonAvatar} from '@/features/photos/components/people/person-avatar'
import {useConfirmMerge} from '@/features/photos/components/people/use-confirm-merge'
import {findNamesake, usePeople, usePeopleActions, type Person} from '@/features/photos/hooks/use-people'
import {cn} from '@/lib/utils'

// A person's name, edited where it stands: click it, type, Enter. The name
// shows at once (the rename is optimistic); an empty one makes the person
// unnamed again. Typing the name of someone who already exists is almost
// always the same person recognised twice, so the field offers to merge the
// two. The offer is only ever taken by its own button, and asks first like
// every merge: Enter does what it says everywhere else and keeps the name
// typed, since a merge cannot be undone and a duplicate name can.
//
// The field and the label share one box (same height, same type), so
// starting and ending an edit moves nothing around it. `editing` may be
// driven from outside (a menu's Rename); left alone the name runs itself.
export function PersonName({
	person,
	editing: editingProp,
	onEditingChange,
	onMerged,
	align = 'center',
	className,
}: {
	person: Pick<Person, 'id' | 'name'>
	editing?: boolean
	onEditingChange?: (editing: boolean) => void
	// The person was folded into another: who survives
	onMerged?: (intoId: string) => void
	align?: 'center' | 'left'
	// Type and colour of the name (the field inherits them)
	className?: string
}) {
	const {t} = useTranslation()
	const {people} = usePeople()
	const {renamePerson, mergePeople} = usePeopleActions()
	const confirmMerge = useConfirmMerge()
	const [editingState, setEditingState] = useState(false)
	const editing = editingProp ?? editingState
	const setEditing = (next: boolean) => {
		setEditingState(next)
		onEditingChange?.(next)
	}
	const [draft, setDraft] = useState('')
	const inputRef = useRef<HTMLInputElement>(null)
	const popoverRef = useRef<HTMLDivElement>(null)
	// Each edit starts from the name as it stands — decided as the edit
	// begins, in render: set from an effect, the field would show the last
	// edit's leftovers for a frame first — selected, ready to replace
	const [wasEditing, setWasEditing] = useState(false)
	if (editing !== wasEditing) {
		setWasEditing(editing)
		if (editing) setDraft(person.name ?? '')
	}
	useEffect(() => {
		if (!editing) return
		inputRef.current?.focus()
		inputRef.current?.select()
	}, [editing])

	const namesake = editing ? findNamesake(people, draft, person.id) : undefined
	const failed = () => toast.error(t('photos-selection.failed'), {area: 'photos'})
	const rename = () => {
		const name = draft.trim()
		setEditing(false)
		if (name !== (person.name ?? '')) renamePerson({id: person.id, name}).catch(failed)
	}
	const merge = async (into: Person) => {
		setEditing(false)
		if (!(await confirmMerge(2, into))) return
		mergePeople({into: into.id, ids: [person.id]})
			.then(() => onMerged?.(into.id))
			.catch(failed)
	}

	if (!editing)
		return (
			<button
				type='button'
				onClick={(event) => {
					event.stopPropagation()
					setEditing(true)
				}}
				title={person.name ? t('photos-people.rename') : undefined}
				className={cn(
					'block h-6 max-w-full min-w-0 truncate rounded-md px-1.5 outline-hidden transition-colors hover:bg-white/8 focus-visible:bg-white/8',
					!person.name && 'text-white/40 hover:text-white/75',
					className,
				)}
			>
				{person.name || t('photos-people.add-name')}
			</button>
		)

	return (
		<Popover open={namesake !== undefined}>
			<PopoverAnchor asChild>
				<input
					ref={inputRef}
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					onClick={(event) => event.stopPropagation()}
					onKeyDown={(event) => {
						// The grid and the sheet both listen for keys; these are the field's
						event.stopPropagation()
						// While an input method is composing, Enter picks a candidate and
						// Escape drops one: neither is the field's. (Safari says the key
						// that ends a composition is not composing, but gives it this code.)
						if (event.nativeEvent.isComposing || event.keyCode === 229) return
						if (event.key === 'Enter') rename()
						else if (event.key === 'Escape') setEditing(false)
					}}
					onBlur={(event) => {
						// Another window looked at is not the name left: it is still being typed
						if (!document.hasFocus()) return
						// Into the merge offer is not away from the name
						if (popoverRef.current?.contains(event.relatedTarget)) return
						// Leaving with a duplicate typed decides nothing: the offer was not taken
						if (namesake) setEditing(false)
						else rename()
					}}
					placeholder={t('photos-people.name-placeholder')}
					aria-label={t('photos-people.name-placeholder')}
					maxLength={100}
					autoComplete='off'
					spellCheck={false}
					className={cn(
						'block h-6 w-full min-w-0 rounded-md bg-white/10 px-1.5 ring-1 ring-white/20 outline-hidden placeholder:font-normal placeholder:text-white/35',
						align === 'center' && 'text-center',
						className,
					)}
				/>
			</PopoverAnchor>
			{namesake && (
				<PopoverContent
					ref={popoverRef}
					align={align === 'center' ? 'center' : 'start'}
					sideOffset={8}
					onOpenAutoFocus={(event) => event.preventDefault()}
					onCloseAutoFocus={(event) => event.preventDefault()}
					className='flex w-auto items-center gap-2.5 rounded-full py-1.5 pr-1.5 pl-2'
				>
					<PersonAvatar person={namesake} size={24} />
					<span className='text-13 whitespace-nowrap text-white/90'>
						{t('photos-people.merge-with', {name: namesake.name})}
					</span>
					<button
						type='button'
						onClick={() => merge(namesake)}
						className='rounded-full bg-white/90 px-2.5 py-1 text-12 font-medium text-black transition-colors hover:bg-white'
					>
						{t('photos-people.merge')}
					</button>
					<button
						type='button'
						onClick={rename}
						className='rounded-full bg-white/10 px-2.5 py-1 text-12 font-medium whitespace-nowrap text-white/80 transition-colors hover:bg-white/15'
					>
						{t('photos-people.keep-separate')}
					</button>
				</PopoverContent>
			)}
		</Popover>
	)
}
