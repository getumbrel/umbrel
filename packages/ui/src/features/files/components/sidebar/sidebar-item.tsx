import {Droppable} from '@/features/files/components/shared/drag-and-drop'
import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {RECENTS_PATH} from '@/features/files/constants'
import {formatItemName} from '@/features/files/utils/format-filesystem-name'
import {cn} from '@/shadcn-lib/utils'
import {tw} from '@/utils/tw'

const selectedClass = tw`
  bg-gradient-to-b from-white/[0.04] to-white/[0.08]
  border-white/6  
  shadow-button-highlight-soft-hpx 
`

type SidebarItem = {
	name: string
	path: string
	type: 'directory'
}

export interface SidebarItemProps {
	item: SidebarItem
	isActive: boolean
	onClick: () => void
	disabled?: boolean
}

export function SidebarItem({item, isActive, onClick, disabled = false}: SidebarItemProps) {
	return (
		<Droppable
			id={`sidebar-${item.path}`}
			path={item.path}
			className={cn(
				'flex w-full rounded-lg border border-transparent from-white/[0.04] to-white/[0.08]  text-12',
				disabled ? 'cursor-default opacity-50' : 'hover:bg-gradient-to-b',
				isActive && !disabled
					? selectedClass
					: disabled
						? 'text-white/40'
						: 'text-white/60 transition-colors hover:bg-white/10 hover:text-white',
			)}
			disabled={disabled || item.path === RECENTS_PATH} // Disable dropping on recents and when disabled
		>
			<button
				onClick={() => {
					if (disabled) return
					onClick()
				}}
				aria-disabled={disabled}
				disabled={disabled}
				className={cn('flex w-full items-center gap-1.5 px-2 py-1.5', disabled && 'cursor-default')}
			>
				{/* We add default modified, size, and operations to satisfy FileItemIcon's expected FileSystemItem type */}
				<FileItemIcon item={{...item, modified: 0, size: 0, operations: []}} className='h-5 w-5' />
				<span className='truncate'>{formatItemName({name: item.name, maxLength: 21})}</span>
			</button>
		</Droppable>
	)
}
