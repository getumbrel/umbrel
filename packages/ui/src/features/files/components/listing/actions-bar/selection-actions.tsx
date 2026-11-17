import {Check, Copy, Download, Ellipsis, Trash2, Undo2} from 'lucide-react'
import {Fragment, type ComponentType} from 'react'
import {useTranslation} from 'react-i18next'

import {DarkTooltip} from '@/components/ui/dark-tooltip'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {PillButton, PillButtonGroup, PillButtonGroupItem} from '@/components/ui/edge-controls'
import {useIsTouchDevice} from '@/features/files/hooks/use-is-touch-device'
import {useItemActions, type ItemAction} from '@/features/files/hooks/use-item-actions'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {useIsFilesReadOnly} from '@/features/files/providers/files-capabilities-context'
import {useFilesStore} from '@/features/files/store/use-files-store'
import {canPerformFileOperation} from '@/features/files/utils/file-capabilities'
import {cn} from '@/lib/utils'
import {useBreakpoint} from '@/utils/tw'

// What the bar offers while a touch screen is selecting: the few things done
// to a selection most, as glyphs sharing one pill, then everything else in
// the sheet behind "More", and Done. As in Photos, what leaves the items in
// place (download, copy) keeps the selection, and the rest end it themselves.
export function SelectionActions() {
	const {t} = useTranslation()
	const breakpoint = useBreakpoint()
	const {isBrowsingTrash} = useNavigate()
	const selectedItems = useFilesStore((state) => state.selectedItems)
	const setIsSelecting = useFilesStore((state) => state.setIsSelectingOnMobile)
	const openSelectionActionSheet = useFilesStore((state) => state.openSelectionActionSheet)
	const {download, remove, restore} = useItemActions()
	const none = selectedItems.length === 0
	// Not while Select all is still loading the rest of the folder (see useItemActions)
	const isSelectingAll = useFilesStore((state) => state.isSelectingAll)
	const canCopy = !none && !isSelectingAll && selectedItems.every((item) => canPerformFileOperation(item, 'copy'))

	// On a phone even Done is a glyph: the count would be crowded out
	const phone = breakpoint === 'sm'
	return (
		<>
			{/* The same glyphs whether or not anything is selected yet, so the pill
			    keeps its shape as the first item is tapped: they wait, dimmed */}
			<PillButtonGroup>
				{isBrowsingTrash ? (
					<GroupAction
						label={t('files-action.restore')}
						icon={Undo2}
						action={restore}
						disabled={!restore || restore.disabled}
					/>
				) : (
					<>
						<GroupAction
							label={t('files-action.download')}
							icon={Download}
							onSelect={download?.onSelect}
							disabled={!download || download.disabled}
						/>
						<GroupAction
							label={t('files-action.copy')}
							icon={Copy}
							disabled={!canCopy}
							onSelect={() => useFilesStore.getState().copyItemsToClipboard()}
						/>
					</>
				)}
				<GroupAction
					label={remove?.label ?? (isBrowsingTrash ? t('files-action.delete') : t('files-action.trash'))}
					icon={Trash2}
					onSelect={remove?.onSelect}
					disabled={!remove || remove.disabled}
					destructive
				/>
				<GroupAction
					label={t('files-view.more')}
					icon={Ellipsis}
					// Selecting everything is in there too, so it opens on an empty selection
					onSelect={openSelectionActionSheet}
				/>
			</PillButtonGroup>
			{phone ? (
				<PillButton icon={Check} aria-label={t('done')} onClick={() => setIsSelecting(false)} />
			) : (
				<PillButton icon={Check} onClick={() => setIsSelecting(false)}>
					{t('done')}
				</PillButton>
			)}
		</>
	)
}

// With a pointer, selecting is not a mode: a click selects, and the bar stays
// as it is but for one place. Where the folder's own actions stand (new
// folder, upload) the selection's take their turn: download and trash a click
// away, and everything the menu under the pointer offers behind "More", for
// anyone who would never think to right-click. Whether there is a selection
// to offer them for:
export function useHasPointerSelection() {
	const isTouchDevice = useIsTouchDevice()
	const isReadOnly = useIsFilesReadOnly()
	// Nothing to offer for a folder still being named
	return useFilesStore(
		(state) =>
			!isTouchDevice &&
			!isReadOnly &&
			state.selectedItems.length > 0 &&
			state.renamingItemPath === null &&
			!state.selectedItems.some((item) => 'isNew' in item && item.isNew),
	)
}

export function PointerSelectionActions() {
	const {t} = useTranslation()
	const {groups, download, remove, restore} = useItemActions()
	// Nothing can be done to a drive in /External, or to an item still uploading
	if (groups.length === 0) return null

	return (
		<PillButtonGroup role='group' aria-label={t('files-selection.actions')}>
			{restore ? (
				<GroupAction action={restore} tooltip />
			) : (
				download && <GroupAction action={download} label={t('files-action.download')} tooltip />
			)}
			{remove && <GroupAction action={remove} tooltip />}
			<DropdownMenu>
				<DarkTooltip label={t('files-view.more')} side='bottom'>
					<DropdownMenuTrigger asChild>
						<PillButtonGroupItem icon={Ellipsis} aria-label={t('files-view.more')} className='min-w-9' />
					</DropdownMenuTrigger>
				</DarkTooltip>
				<DropdownMenuContent align='end' className='w-52'>
					{groups.map((group, index) => (
						<Fragment key={group.map((action) => action.id).join()}>
							{index > 0 && <DropdownMenuSeparator />}
							{group.map((action) => (
								<DropdownMenuItem
									key={action.id}
									disabled={action.disabled}
									onSelect={action.onSelect}
									className={cn(action.destructive && 'text-destructive2-lightest focus:text-destructive2-lightest')}
								>
									{action.label}
									{action.shortcut && <DropdownMenuShortcut>{action.shortcut}</DropdownMenuShortcut>}
								</DropdownMenuItem>
							))}
						</Fragment>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
		</PillButtonGroup>
	)
}

// One glyph in the selection's pill
function GroupAction({
	action,
	label = action?.label ?? '',
	icon = action?.icon,
	onSelect = action?.onSelect,
	disabled = action?.disabled,
	destructive = action?.destructive,
	tooltip = false,
}: {
	action?: ItemAction
	label?: string
	icon?: ComponentType<{className?: string}>
	onSelect?: () => void
	disabled?: boolean
	destructive?: boolean
	// Named on hover, where there is a pointer to hover with
	tooltip?: boolean
}) {
	const button = (
		<PillButtonGroupItem
			icon={icon}
			aria-label={label}
			disabled={disabled}
			onClick={onSelect}
			className={cn('min-w-9', destructive && 'hover:bg-destructive2/25 hover:text-destructive2-lightest')}
		/>
	)
	if (!tooltip) return button
	return (
		<DarkTooltip label={label} side='bottom'>
			{button}
		</DarkTooltip>
	)
}
