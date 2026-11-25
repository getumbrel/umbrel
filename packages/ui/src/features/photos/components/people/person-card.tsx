import {Check, MoreHorizontal} from 'lucide-react'
import {useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'

import {ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger} from '@/components/ui/context-menu'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from '@/components/ui/dropdown-menu'
import {useIsTouchDevice} from '@/features/files/hooks/use-is-touch-device'
import {PersonAvatar} from '@/features/photos/components/people/person-avatar'
import {PersonName} from '@/features/photos/components/people/person-name'
import {usePersonMenu} from '@/features/photos/components/people/use-person-menu'
import type {Person} from '@/features/photos/hooks/use-people'
import {cn} from '@/lib/utils'
import {formatNumberI18n} from '@/utils/number'

// One person in the People grid: their face in a circle, their name beneath
// — edited in place — and how many photos they are in. A click opens their
// photos; while people are being selected (to merge, to hide) it selects
// instead and the circle wears the tiles' own ring and check. Their menu is
// the face's context menu — a right-click, or a long press on touch, as on
// the photo tiles — and where there is a pointer to hover with, a ⋯ button
// that appears with it. Rename waits for the menu to close: while it is open
// a menu takes the focus back from the name field, and a field left is a
// field done, so the edit begins as the menu lets the focus go.
export function PersonCard({
	person,
	selecting,
	selected,
	onOpen,
	onToggle,
}: {
	person: Person
	selecting: boolean
	selected: boolean
	onOpen: () => void
	onToggle: () => void
}) {
	const {t, i18n} = useTranslation()
	const isTouchDevice = useIsTouchDevice()
	const [editing, setEditing] = useState(false)
	const renaming = useRef(false)
	const menu = usePersonMenu(person, {
		onRename: () => {
			renaming.current = true
		},
	})
	const renameAfterMenu = (event: Event) => {
		if (!renaming.current) return
		renaming.current = false
		// The focus is the field's, not for what opened the menu to have back
		event.preventDefault()
		setEditing(true)
	}
	const count = t('photos-collections.count', {
		count: person.count,
		formattedCount: formatNumberI18n({n: person.count, showDecimals: false, locale: i18n.language}),
	})

	return (
		<div className='group relative flex min-w-0 flex-col items-center gap-2'>
			<ContextMenu>
				<ContextMenuTrigger asChild>
					<button
						type='button'
						onClick={selecting ? onToggle : onOpen}
						aria-label={[person.name ?? t('photos-people.unnamed'), count].join(', ')}
						aria-pressed={selecting ? selected : undefined}
						className={cn(
							// A long press is for the menu, not the system's callout or a selection
							'relative block w-full rounded-full outline-hidden select-none [-webkit-touch-callout:none]',
							// Lifts a touch on hover, gives under the pointer while pressed — as the album cards do
							'motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out motion-safe:group-hover:scale-[1.03] motion-safe:active:scale-[0.98] motion-safe:active:duration-100',
							// The rim, drawn over the photograph (an inset ring under it would be hidden)
							'after:pointer-events-none after:absolute after:inset-0 after:rounded-full after:ring-1 after:ring-white/12 after:transition-shadow after:duration-150 after:ring-inset focus-visible:after:ring-2 focus-visible:after:ring-white/60',
							selected && 'after:ring-[3px] after:ring-brand',
							person.isHidden && 'opacity-50 transition-opacity hover:opacity-100',
						)}
					>
						<PersonAvatar person={person} size={180} fluid className='aspect-square w-full shadow-lg' />
						{/* Where the circle's edge meets its top-left diagonal: the tiles' selection mark */}
						{selecting && (
							<span
								aria-hidden
								className={cn(
									'absolute top-[8%] left-[8%] flex size-[22px] items-center justify-center rounded-full shadow-[0_1px_3px_rgb(0_0_0/0.35)]',
									selected ? 'bg-brand text-white' : 'border-[1.5px] border-white/85 bg-black/30',
								)}
							>
								{selected && <Check className='size-3.5' strokeWidth={3} />}
							</span>
						)}
					</button>
				</ContextMenuTrigger>
				<ContextMenuContent onCloseAutoFocus={renameAfterMenu}>
					{menu.map((item) => (
						<ContextMenuItem key={item.key} onSelect={item.onSelect}>
							{item.label}
						</ContextMenuItem>
					))}
				</ContextMenuContent>
			</ContextMenu>
			<div className='flex w-full min-w-0 flex-col items-center'>
				{person.isHidden ? (
					<span className='block h-6 max-w-full truncate px-1.5 text-13 leading-6 font-medium text-white/60'>
						{person.name ?? t('photos-people.unnamed')}
					</span>
				) : (
					<PersonName
						person={person}
						editing={editing}
						onEditingChange={setEditing}
						className='text-13 leading-6 font-medium'
					/>
				)}
				<span className='text-12 text-white/45 tabular-nums'>{count}</span>
			</div>
			{/* The person's menu, where a hover can summon it. Touch has the long
			    press instead: a disc over every face is all a phone's grid would be. */}
			{!selecting && !isTouchDevice && (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<button
							type='button'
							aria-label={t('photos-people.options')}
							className='pointer-events-none absolute top-0 right-0 z-10 flex size-7 items-center justify-center rounded-full bg-black/50 text-white/90 opacity-0 outline-hidden backdrop-blur-sm transition-opacity duration-200 group-hover:pointer-events-auto group-hover:opacity-100 hover:bg-black/70 focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-white/60 data-[state=open]:pointer-events-auto data-[state=open]:opacity-100'
						>
							<MoreHorizontal className='size-4' />
						</button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align='end' onCloseAutoFocus={renameAfterMenu}>
						{menu.map((item) => (
							<DropdownMenuItem key={item.key} onSelect={item.onSelect}>
								{item.label}
							</DropdownMenuItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>
			)}
		</div>
	)
}
