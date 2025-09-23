import {FaEject} from 'react-icons/fa6'

import {Droppable} from '@/features/files/components/shared/drag-and-drop'
import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {cn} from '@/shadcn-lib/utils'
import {t} from '@/utils/i18n'
import {tw} from '@/utils/tw'

const selectedClass = tw`
  bg-gradient-to-b from-white/[0.04] to-white/[0.08]
  border-white/6
  shadow-button-highlight-soft-hpx
`

export interface SidebarNetworkShareItemProps {
	host: string
	rootPath: string // /Network/<host>
	onEject: () => Promise<void> | void
	disabled?: boolean
}

export function SidebarNetworkShareItem({host, rootPath, onEject, disabled}: SidebarNetworkShareItemProps) {
	const {navigateToDirectory, currentPath} = useNavigate()
	const isActive = currentPath.startsWith(rootPath)

	return (
		<Droppable
			id={`sidebar-${rootPath}`}
			path={rootPath}
			onClick={() => navigateToDirectory(rootPath)}
			className={cn(
				'flex items-center gap-1.5 rounded-lg border border-transparent from-white/[0.04] to-white/[0.08] px-2 py-1.5 text-12 hover:bg-gradient-to-b',
				isActive ? selectedClass : 'text-white/60 transition-colors hover:bg-white/10 hover:text-white',
			)}
			role='button'
		>
			<FileItemIcon
				item={{path: rootPath, type: 'directory', operations: [], size: 0, modified: 0, name: host}}
				className='h-5 w-5 flex-shrink-0'
			/>
			<span className='min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap'>{host}</span>

			{/* Eject button */}
			<button
				onClick={(e) => {
					// prevent navigating into /Network
					e.stopPropagation()

					// eject (remove) the host
					onEject()
				}}
				aria-label={t('files-action.eject-disk')}
				disabled={disabled}
				className={cn(disabled ? 'cursor-not-allowed opacity-50' : 'hover:text-white')}
			>
				<FaEject className='text-white/60' />
			</button>
		</Droppable>
	)
}
