import {FaEject} from 'react-icons/fa6'
import {RiErrorWarningFill, RiHardDrive2Fill} from 'react-icons/ri'
import {useNavigate as useReactRouterNavigate} from 'react-router-dom'

import {Droppable} from '@/features/files/components/shared/drag-and-drop'
import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {useExternalStorage} from '@/features/files/hooks/use-external-storage'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import type {ExternalStorageDevice} from '@/features/files/types'
import {formatFilesystemSize} from '@/features/files/utils/format-filesystem-size'
import {useQueryParams} from '@/hooks/use-query-params'
import {cn} from '@/shadcn-lib/utils'
import {t} from '@/utils/i18n'
import {tw} from '@/utils/tw'

const selectedClass = tw`
  bg-gradient-to-b from-white/[0.04] to-white/[0.08]
  border-white/6  
  shadow-button-highlight-soft-hpx 
`

export interface SidebarExternalStorageItemProps {
	item: ExternalStorageDevice
}

export function SidebarExternalStorageItem({item}: SidebarExternalStorageItemProps) {
	const {ejectDisk} = useExternalStorage()
	const {navigateToDirectory, currentPath} = useNavigate()
	const navigate = useReactRouterNavigate()
	const {addLinkSearchParams} = useQueryParams()
	const isDiskActive = item.partitions.length === 1 && currentPath === item.partitions[0].mountpoints[0]

	const handleClick = () => {
		if (!item.isMounted && !item.isFormatting) {
			// Open format dialog
			navigate({
				search: addLinkSearchParams({
					dialog: 'files-format-drive',
					deviceId: item.id,
				}),
			})
		} else if (item.partitions.length === 1) {
			// Navigate to the partition
			navigateToDirectory(item.partitions[0].mountpoints[0])
		}
	}

	// For disks with a single partition, we display the partition name/label
	// For disks with multiple partitions, we display the disk name
	const displayName =
		item.partitions.length === 1 ? item.partitions[0].label || item.partitions[0].mountpoints[0] : item.name

	const ExternalStorageDisk = (
		<div
			onClick={handleClick}
			role={!item.isMounted || item.partitions.length === 1 ? 'button' : undefined}
			className={cn(
				'flex w-full items-center gap-1.5 px-2 py-1.5',
				item.isFormatting && 'cursor-not-allowed opacity-50',
			)}
		>
			<div className='relative'>
				<FileItemIcon
					item={{...item, path: item.id, type: 'external-storage', operations: [], size: 0, modified: 0}}
					className='h-5 w-5 flex-shrink-0'
				/>
				{/* Warning badge for drives that need formatting */}
				{!item.isMounted && !item.isFormatting && (
					<div className='absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-[#FF9500]'>
						<RiErrorWarningFill className='size-3.5 text-black' />
					</div>
				)}
			</div>
			<div className='flex min-w-0 flex-1 items-center justify-between gap-1'>
				<div className='flex min-w-0 flex-1 flex-col'>
					<span className='min-w-0 overflow-hidden text-ellipsis whitespace-nowrap'>
						{item.isFormatting ? t('files-format.formatting') : displayName}
					</span>
				</div>
				<div className='flex flex-shrink-0 items-center gap-2'>
					<span className='text-white/30'>{formatFilesystemSize(item.size)}</span>
					{item.isMounted && (
						<button
							onClick={(e) => {
								e.stopPropagation() // Prevent the click from triggering a navigation
								ejectDisk({deviceId: item.id})
							}}
							aria-label={t('files-action.eject-disk')}
						>
							<FaEject className='text-white/60 hover:text-white' />
						</button>
					)}
				</div>
			</div>
		</div>
	)

	return (
		<div className='flex w-full flex-col'>
			{item.partitions.length > 1 ? (
				<>
					<div
						className={cn(
							'flex w-full rounded-lg border border-transparent from-white/[0.04] to-white/[0.08] text-12 text-white/60',
						)}
					>
						{ExternalStorageDisk}
					</div>
					<div className='flex flex-col gap-0.5 pl-7'>
						{item.partitions.map((partition: ExternalStorageDevice['partitions'][number]) => (
							<Droppable
								key={partition.mountpoints[0]}
								id={`sidebar-${partition.mountpoints[0]}`}
								path={partition.mountpoints[0]}
								onClick={() => navigateToDirectory(partition.mountpoints[0])}
								className={cn(
									'flex items-center gap-1.5 rounded-lg border border-transparent from-white/[0.04] to-white/[0.08] px-2 py-1.5 text-12 hover:bg-gradient-to-b',
									currentPath === partition.mountpoints[0]
										? selectedClass
										: 'text-white/60 transition-colors hover:bg-white/10 hover:text-white',
								)}
								role='button'
							>
								<RiHardDrive2Fill className='h-3 w-3 flex-shrink-0' />
								<span className='min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-11'>
									{partition.label || partition.mountpoints[0]}
								</span>
								<span className='text-11 text-white/30'>{formatFilesystemSize(partition.size)}</span>
							</Droppable>
						))}
					</div>
				</>
			) : (
				<Droppable
					id={`sidebar-${item.id}`}
					path={item.partitions[0]?.mountpoints[0]}
					className={cn(
						'flex w-full rounded-lg border border-transparent from-white/[0.04] to-white/[0.08] text-12 hover:bg-gradient-to-b',
						isDiskActive ? selectedClass : 'text-white/60 transition-colors hover:bg-white/10 hover:text-white',
					)}
				>
					{ExternalStorageDisk}
				</Droppable>
			)}
		</div>
	)
}
