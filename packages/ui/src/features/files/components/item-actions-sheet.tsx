import {CircleCheck, CircleDashed} from 'lucide-react'
import {useEffect, useRef} from 'react'
import {useTranslation} from 'react-i18next'

import {Drawer, DrawerContent, DrawerDescription, DrawerTitle} from '@/components/ui/drawer'
import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {availableActions, useItemActions, type ItemAction} from '@/features/files/hooks/use-item-actions'
import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FileSystemItem} from '@/features/files/types'
import {fileTypeLabel} from '@/features/files/utils/file-type-label'
import {formatFilesystemDateShort} from '@/features/files/utils/format-filesystem-date'
import {formatFilesystemSize} from '@/features/files/utils/format-filesystem-size'
import {useLanguage} from '@/hooks/use-language'
import {cn} from '@/lib/utils'
import {formatNumberI18n} from '@/utils/number'

// Actions the sheet leaves out: a tap already opens an item, and pasting into
// a folder is offered where it is pasted (the island, the + menu)
const LEFT_OUT = ['open', 'paste']
// Actions that go on to ask about the selection in a dialog of their own, so
// it has to outlive the sheet
const KEEPS_SELECTION = ['delete']

// What can be done to an item, on a touch screen. Holding a finger on an item
// brings this up from the bottom edge: the item itself at the top, so it is
// plain what the actions are about, and under it everything that can be done
// to it, in rows big enough for a thumb. Only what applies is listed. The bar
// opens the same sheet for the whole selection while selecting.
export function ItemActionsSheet() {
	const {t, i18n} = useTranslation()
	const actionSheet = useFilesStore((state) => state.actionSheet)
	const closeActionSheet = useFilesStore((state) => state.closeActionSheet)
	const selectedItems = useFilesStore((state) => state.selectedItems)
	const setSelectedItems = useFilesStore((state) => state.setSelectedItems)
	const isSelecting = useFilesStore((state) => state.isSelectingOnMobile)
	const selectAll = useFilesStore((state) => state.selectAllHandler)
	const {groups} = useItemActions()

	// The sheet comes up under the finger that is still holding the item, and
	// that finger lifting must not press whatever row has arrived beneath it.
	// Its rows answer once the touch that raised the sheet is over, and a
	// moment after: the tap a lifted finger leaves behind comes late.
	const armed = useRef(false)
	const count = selectedItems.length
	// The bar's More brings it up with nothing selected yet too: selecting
	// everything is in here. A held item's sheet is about that item, and goes
	// when the item does.
	const isOpen = actionSheet === 'selection' || (actionSheet === 'item' && count > 0)
	useEffect(() => {
		if (!isOpen) return
		armed.current = false
		let timer = 0
		const arm = () => {
			window.clearTimeout(timer)
			timer = window.setTimeout(() => (armed.current = true), 280)
		}
		// Raised by a tap (the bar's More) the touch is already over
		if (actionSheet === 'selection') arm()
		window.addEventListener('pointerup', arm, {capture: true})
		window.addEventListener('pointercancel', arm, {capture: true})
		return () => {
			window.clearTimeout(timer)
			window.removeEventListener('pointerup', arm, {capture: true})
			window.removeEventListener('pointercancel', arm, {capture: true})
		}
	}, [isOpen, actionSheet])
	const whenArmed = (run: () => void) => () => {
		if (armed.current) run()
	}

	const close = ({keepSelection = false} = {}) => {
		closeActionSheet()
		// A held item was only selected for the sheet to act on
		if (actionSheet === 'item' && !isSelecting && !keepSelection) setSelectedItems([])
	}
	const run = (action: ItemAction) => {
		action.onSelect()
		close({keepSelection: KEEPS_SELECTION.includes(action.id)})
	}

	const single = count === 1 ? selectedItems[0] : undefined
	const totalSize = selectedItems.reduce((total, item) => total + (item.size ?? 0), 0)
	// While Select all loads the rest of a folder every action waits (see
	// useItemActions). The sheet stays up through it, so its rows stay where
	// they are, dimmed, rather than leave and come back.
	const isSelectingAll = useFilesStore((state) => state.isSelectingAll)
	const available = availableActions(groups, {without: LEFT_OUT})
	const shownBefore = useRef(available)
	if (!isSelectingAll) shownBefore.current = available
	const shown = isSelectingAll ? shownBefore.current : available

	return (
		<Drawer open={isOpen} onOpenChange={(open) => !open && close()}>
			<DrawerContent withScroll className='gap-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]'>
				{single ? (
					<ItemHeader item={single} />
				) : (
					<div className='px-1'>
						<DrawerTitle className='text-17'>
							{count === 0
								? t('files-selection.none')
								: t('files-selection.count', {
										count,
										formattedCount: formatNumberI18n({n: count, showDecimals: false, locale: i18n.language}),
									})}
						</DrawerTitle>
						{/* Named for screen readers by the title alone when there is no size to give */}
						<DrawerDescription className={totalSize > 0 ? 'mt-1' : 'sr-only'}>
							{totalSize > 0 ? formatFilesystemSize(totalSize) : t('files-selection.actions')}
						</DrawerDescription>
					</div>
				)}

				{actionSheet === 'selection' && selectAll && (
					<ActionGroup>
						<ActionRow
							action={{
								id: 'select-all',
								label: t('files-selection.select-all'),
								icon: CircleCheck,
								onSelect: selectAll,
							}}
							// Selecting more keeps the sheet's subject on screen behind it: it stays up
							onSelect={whenArmed(selectAll)}
						/>
						{count > 0 && (
							<ActionRow
								action={{
									id: 'deselect-all',
									label: t('files-selection.deselect-all'),
									icon: CircleDashed,
									onSelect: () => setSelectedItems([]),
								}}
								onSelect={whenArmed(() => {
									closeActionSheet()
									setSelectedItems([])
								})}
							/>
						)}
					</ActionGroup>
				)}

				{shown.map((group) => (
					<ActionGroup key={group.map((action) => action.id).join()}>
						{group.map((action) => (
							<ActionRow
								key={action.id}
								action={action}
								waiting={isSelectingAll}
								onSelect={whenArmed(() => !isSelectingAll && run(action))}
							/>
						))}
					</ActionGroup>
				))}
			</DrawerContent>
		</Drawer>
	)
}

// The item the sheet is about: its icon or picture, its name in full and what it is
function ItemHeader({item}: {item: FileSystemItem}) {
	const {t} = useTranslation()
	const [languageCode] = useLanguage()
	const details = [
		item.type === 'directory' ? t('files-type.directory') : fileTypeLabel(item, t),
		item.size != null && (item.type !== 'directory' || item.size > 0) ? formatFilesystemSize(item.size) : undefined,
		item.modified ? formatFilesystemDateShort(item.modified, languageCode) : undefined,
	].filter(Boolean)

	return (
		<div className='flex items-center gap-3.5 px-1'>
			<FileItemIcon item={item} className='size-12 shrink-0' thumbnailFit='hug' />
			<div className='min-w-0 flex-1'>
				<DrawerTitle className='line-clamp-2 text-17 leading-snug break-words'>{item.name}</DrawerTitle>
				{/* Set out as a row's own details are (see ListViewFileItem) */}
				<DrawerDescription className='mt-1 truncate'>{details.join(' - ')}</DrawerDescription>
			</div>
		</div>
	)
}

const ActionGroup = ({children}: {children: React.ReactNode}) => (
	<div className='shrink-0 divide-y divide-white/6 overflow-hidden rounded-17 bg-white/6'>{children}</div>
)

function ActionRow({
	action,
	onSelect,
	waiting = false,
}: {
	action: ItemAction
	onSelect: () => void
	// Not to be used just now: it stays in its place, dimmed
	waiting?: boolean
}) {
	const Icon = action.icon
	return (
		<button
			type='button'
			onClick={onSelect}
			aria-disabled={waiting || undefined}
			className={cn(
				'flex min-h-[50px] w-full items-center gap-3.5 px-4 py-2 text-left text-15 font-medium -tracking-3 outline-hidden transition-[color,background-color,opacity] duration-100 focus-visible:bg-white/10 active:bg-white/10',
				action.destructive ? 'text-destructive2-lightest' : 'text-white/90',
				waiting && 'opacity-50 active:bg-transparent',
			)}
		>
			<Icon className={cn('size-5 shrink-0', !action.destructive && 'text-white/55')} />
			<span className='min-w-0 flex-1 truncate'>{action.label}</span>
		</button>
	)
}
