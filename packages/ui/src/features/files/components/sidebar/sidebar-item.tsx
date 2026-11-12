import {Droppable} from '@/features/files/components/shared/drag-and-drop'
import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {RECENTS_PATH, SYSTEM_MANAGED_ROOT_PATHS} from '@/features/files/constants'
import {formatItemName} from '@/features/files/utils/format-filesystem-name'
import type {Machine} from '@/features/machines/types'
import {cn} from '@/lib/utils'
import {focusRingClass} from '@/utils/element-classes'
import {tw} from '@/utils/tw'

const selectedClass = tw`
  bg-linear-to-b from-white/[0.04] to-white/[0.08]
  border-white/6  
  shadow-button-highlight-soft-hpx 
`

type SidebarItem = {
	name: string
	path: string
	type: 'directory' | 'external-storage' | 'network-root' | 'network-share'
}

export interface SidebarItemProps {
	item: SidebarItem
	isActive: boolean
	onClick: () => void
	disabled?: boolean
	// Replaces the default file-type icon (e.g. the owner's avatar on a member's shared home)
	icon?: React.ReactNode
	machine?: Machine | null
}

export function SidebarItem({item, isActive, onClick, disabled = false, icon, machine}: SidebarItemProps) {
	return (
		<Droppable
			id={`sidebar-${item.path}`}
			path={item.path}
			className={cn(
				'flex w-full rounded-lg border border-transparent from-white/[0.04] to-white/[0.08] text-12',
				disabled ? 'cursor-default opacity-50' : 'hover:bg-linear-to-b',
				isActive && !disabled
					? selectedClass
					: disabled
						? 'text-white/40'
						: 'text-white/60 hover:bg-white/10 hover:text-white',
			)}
			// Disable dropping when disabled, on Recents (not a real directory) and on
			// system-managed roots (/Apps, /Machines) that Files never writes into
			disabled={disabled || item.path === RECENTS_PATH || SYSTEM_MANAGED_ROOT_PATHS.has(item.path)}
		>
			<button
				onClick={() => {
					if (disabled) return
					onClick()
				}}
				aria-current={isActive ? 'page' : undefined}
				aria-disabled={disabled}
				disabled={disabled}
				className={cn(
					'flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5',
					focusRingClass,
					disabled && 'cursor-default',
				)}
			>
				{/* We add default modified, size, and operations to satisfy FileItemIcon's expected FileSystemItem type */}
				{icon ?? (
					<FileItemIcon item={{...item, modified: 0, size: 0, operations: []}} machine={machine} className='h-5 w-5' />
				)}
				<span className='truncate'>{formatItemName({name: item.name, maxLength: 21})}</span>
			</button>
		</Droppable>
	)
}
