import {AnimatePresence, motion} from 'framer-motion'
import {useNavigate} from 'react-router-dom'

import {SidebarItem} from '@/features/files/components/sidebar/sidebar-item'
import {useNavigate as useFilesNavigate} from '@/features/files/hooks/use-navigate'
import {useIsFilesReadOnly} from '@/features/files/providers/files-capabilities-context'
import {Share} from '@/features/files/types'
import {useQueryParams} from '@/hooks/use-query-params'
import {ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger} from '@/shadcn-components/ui/context-menu'
import {t} from '@/utils/i18n'

export function SidebarShares({shares}: {shares: (Share | null)[]}) {
	const {navigateToDirectory, currentPath} = useFilesNavigate()
	const navigate = useNavigate()
	const {addLinkSearchParams} = useQueryParams()
	const isReadOnly = useIsFilesReadOnly()

	const openShareInfoDialog = (share: Share) => {
		navigate({
			search: addLinkSearchParams({
				dialog: 'files-share-info',
				'files-share-info-name': share?.name || '',
				'files-share-info-path': share?.path || '',
			}),
		})
	}

	return (
		<AnimatePresence initial={false}>
			{shares.map((share: Share | null) => {
				if (!share) return null
				return (
					<motion.div
						key={`sidebar-share-${share.path}`}
						initial={{opacity: 0, height: 0}}
						animate={{opacity: 1, height: 'auto'}}
						exit={{opacity: 0, height: 0}}
						transition={{duration: 0.2}}
					>
						<ContextMenu>
							<ContextMenuTrigger asChild>
								<div>
									<SidebarItem
										item={{
											name: share.name,
											path: share.path,
											type: 'directory',
										}}
										isActive={currentPath === share.path}
										onClick={() => navigateToDirectory(share.path)}
									/>
								</div>
							</ContextMenuTrigger>
							{/* We don't allow context menu in read-only mode */}
							{!isReadOnly ? (
								<ContextMenuContent>
									<ContextMenuItem onClick={() => openShareInfoDialog(share)}>
										{t('files-action.sharing')}
									</ContextMenuItem>
								</ContextMenuContent>
							) : null}
						</ContextMenu>
					</motion.div>
				)
			})}
		</AnimatePresence>
	)
}
