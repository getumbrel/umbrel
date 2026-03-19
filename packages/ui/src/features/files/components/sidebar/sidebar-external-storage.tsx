import {AnimatePresence, motion} from 'motion/react'
import {useTranslation} from 'react-i18next'
import {useNavigate} from 'react-router-dom'

import {ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger} from '@/components/ui/context-menu'
import {SidebarExternalStorageItem} from '@/features/files/components/sidebar/sidebar-external-storage-item'
import {useExternalStorage} from '@/features/files/hooks/use-external-storage'
import type {ExternalStorageDevice} from '@/features/files/types'
import {useQueryParams} from '@/hooks/use-query-params'

export function SidebarExternalStorage() {
	const {t} = useTranslation()
	const {disks, isLoadingExternalStorage, ejectDisk, isExternalStorageSupported} = useExternalStorage()
	const navigate = useNavigate()
	const {addLinkSearchParams} = useQueryParams()

	// Don't render anything for non-supported devices
	if (!isExternalStorageSupported) {
		return null
	}

	// Don't render anything if the disks are still loading or there are no disks
	if (isLoadingExternalStorage || !disks?.length) {
		return null
	}

	return (
		<AnimatePresence initial={false}>
			{disks.map((disk: ExternalStorageDevice) => (
				<motion.div
					key={`sidebar-external-storage-${disk.id}`}
					initial={{opacity: 0, height: 0}}
					animate={{opacity: 1, height: 'auto'}}
					exit={{opacity: 0, height: 0}}
					transition={{duration: 0.2}}
				>
					<ContextMenu>
						<ContextMenuTrigger asChild>
							<div>
								<SidebarExternalStorageItem
									item={{
										name: disk.name,
										id: disk.id,
										// If the drive requires formatting, don't show any partitions
										// Otherwise, only show mounted partitions
										partitions: !disk.isMounted
											? []
											: disk.partitions
													.filter((partition: any) => partition.mountpoints?.length > 0)
													.map((partition: any) => ({
														...partition,
														mountpoint: partition.mountpoints?.[0] ?? '',
													})),
										size: disk.size,
										isMounted: disk.isMounted,
										isFormatting: disk.isFormatting,
										transport: disk.transport,
									}}
								/>
							</div>
						</ContextMenuTrigger>
						<ContextMenuContent>
							{disk.isMounted && (
								<ContextMenuItem onClick={() => ejectDisk({deviceId: disk.id})}>
									{t('files-action.eject-disk')}
								</ContextMenuItem>
							)}
							<ContextMenuItem
								onClick={() => {
									navigate({
										search: addLinkSearchParams({
											dialog: 'files-format-drive',
											deviceId: disk.id,
										}),
									})
								}}
							>
								{t('files-action.format-drive')}
							</ContextMenuItem>
							{disk.isMounted && disk.partitions.length === 1 && (
								<ContextMenuItem
									onClick={() => {
										const partition = disk.partitions[0]
										navigate({
											search: addLinkSearchParams({
												dialog: 'files-share-info',
												'files-share-info-name': partition.label || partition.mountpoints?.[0] || '',
												'files-share-info-path': partition.mountpoints?.[0] || '',
											}),
										})
									}}
								>
									{t('files-action.sharing')}
								</ContextMenuItem>
							)}
						</ContextMenuContent>
					</ContextMenu>
				</motion.div>
			))}
		</AnimatePresence>
	)
}
