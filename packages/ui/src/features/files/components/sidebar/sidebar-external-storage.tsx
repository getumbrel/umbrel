import {AnimatePresence, motion} from 'framer-motion'
import {useNavigate} from 'react-router-dom'

import {SidebarExternalStorageItem} from '@/features/files/components/sidebar/sidebar-external-storage-item'
import {useExternalStorage} from '@/features/files/hooks/use-external-storage'
import type {ExternalStorageDevice} from '@/features/files/types'
import {useQueryParams} from '@/hooks/use-query-params'
import {ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger} from '@/shadcn-components/ui/context-menu'
import {t} from '@/utils/i18n'

export function SidebarExternalStorage() {
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
										partitions: !disk.isMounted
											? []
											: disk.partitions.map((partition: any) => ({
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
						</ContextMenuContent>
					</ContextMenu>
				</motion.div>
			))}
		</AnimatePresence>
	)
}
