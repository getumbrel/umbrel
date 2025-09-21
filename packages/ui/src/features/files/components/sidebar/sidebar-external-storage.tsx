import {AnimatePresence, motion} from 'framer-motion'

import {SidebarExternalStorageItem} from '@/features/files/components/sidebar/sidebar-external-storage-item'
import {useExternalStorage} from '@/features/files/hooks/use-external-storage'
import {ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger} from '@/shadcn-components/ui/context-menu'
import {t} from '@/utils/i18n'

export function SidebarExternalStorage() {
	const {disks, isLoadingExternalStorage, ejectDisk, isExternalStorageSupported} = useExternalStorage()

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
			{disks.map((disk) => (
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
										partitions: disk.partitions.map((partition) => ({
											...partition,
											mountpoint: partition.mountpoints?.[0] ?? '',
										})),
										size: disk.size,
									}}
								/>
							</div>
						</ContextMenuTrigger>
						<ContextMenuContent>
							<ContextMenuItem onClick={() => ejectDisk({deviceId: disk.id})}>
								{t('files-action.eject-disk')}
							</ContextMenuItem>
						</ContextMenuContent>
					</ContextMenu>
				</motion.div>
			))}
		</AnimatePresence>
	)
}
