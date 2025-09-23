import {AnimatePresence, motion} from 'framer-motion'
import {useMemo} from 'react'
import {FaPlus} from 'react-icons/fa6'
import {useNavigate as useReactRouterNavigate} from 'react-router-dom'

import networkIcon from '@/features/files/assets/network-icon.png'
import {Droppable} from '@/features/files/components/shared/drag-and-drop'
import {SidebarNetworkShareItem} from '@/features/files/components/sidebar/sidebar-network-share-item'
import {NETWORK_STORAGE_PATH} from '@/features/files/constants'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {useNetworkStorage} from '@/features/files/hooks/use-network-storage'
import {useQueryParams} from '@/hooks/use-query-params'
import {ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger} from '@/shadcn-components/ui/context-menu'
import {cn} from '@/shadcn-lib/utils'
import {t} from '@/utils/i18n'
import {tw} from '@/utils/tw'

export function SidebarNetworkStorage() {
	const {shares, isLoadingShares, removeHostOrShare, isRemovingShare} = useNetworkStorage()

	// Group the mounted shares by host so that we render single network device items even when there are multiple shares for the same host.
	const hosts = useMemo(() => {
		if (!shares) return []
		const map = new Map<string, {host: string; hostPath: string}>()
		for (const s of shares) {
			// only render hosts with mounted shares in the sidebar
			if (!s.isMounted) continue
			const hostPath = s.mountPath.split('/').slice(0, -1).join('/') // /Network/<host>
			if (!map.has(s.host)) {
				map.set(s.host, {host: s.host, hostPath})
			}
		}
		return Array.from(map.values())
	}, [shares])

	return (
		<>
			{/* Permanent /Network root item with "Add Network Share" button */}
			<NetworkRootItem />

			{/* Mounted network devices (if any) */}
			{!isLoadingShares && hosts.length > 0 && (
				<AnimatePresence initial={false}>
					{hosts.map(({host, hostPath}) => (
						<motion.div
							key={`sidebar-network-${host}`}
							initial={{opacity: 0, height: 0}}
							animate={{opacity: 1, height: 'auto'}}
							exit={{opacity: 0, height: 0}}
							transition={{duration: 0.2}}
						>
							<ContextMenu>
								<ContextMenuTrigger asChild>
									<div>
										<SidebarNetworkShareItem
											host={host}
											rootPath={hostPath}
											onEject={() => removeHostOrShare(hostPath)}
											disabled={isRemovingShare}
										/>
									</div>
								</ContextMenuTrigger>
								<ContextMenuContent>
									<ContextMenuItem disabled={isRemovingShare} onClick={() => removeHostOrShare(hostPath)}>
										{t('files-action.remove-network-host')}
									</ContextMenuItem>
								</ContextMenuContent>
							</ContextMenu>
						</motion.div>
					))}
				</AnimatePresence>
			)}
		</>
	)
}

/* ------------------------------------------------------------------
 * Always rendered /Network root item with "Add Network Share" button
 * ---------------------------------------------------------------- */
const selectedClass = tw`
  bg-gradient-to-b from-white/[0.04] to-white/[0.08]
  border-white/6
  shadow-button-highlight-soft-hpx
`

function NetworkRootItem() {
	const {navigateToDirectory, currentPath} = useNavigate()
	const isActive = currentPath === NETWORK_STORAGE_PATH
	const navigate = useReactRouterNavigate()
	const {addLinkSearchParams} = useQueryParams()

	return (
		<Droppable
			id={`sidebar-${NETWORK_STORAGE_PATH}`}
			path={NETWORK_STORAGE_PATH}
			onClick={() => navigateToDirectory(NETWORK_STORAGE_PATH)}
			className='group flex items-stretch gap-0.5 rounded-lg text-12'
			role='button'
		>
			<div
				className={cn(
					'flex flex-1 items-center gap-1.5 rounded-l-lg border border-r-0 border-transparent from-white/[0.04] to-white/[0.08] px-2 py-1.5 group-hover:bg-gradient-to-b',
					isActive ? selectedClass : 'text-white/60 transition-colors group-hover:bg-white/10 group-hover:text-white',
				)}
			>
				<img src={networkIcon} alt='' className='h-5 w-auto flex-shrink-0' />
				<span className='min-w-0 overflow-hidden text-ellipsis whitespace-nowrap'>
					{t('files-sidebar.network-sidebar')}
				</span>
			</div>
			<div
				className={cn(
					'group/plus flex items-center justify-center rounded-r-lg border border-l-0 border-transparent from-white/[0.04] to-white/[0.08] px-2 py-1.5 group-hover:bg-gradient-to-b',
					isActive ? selectedClass : 'transition-colors group-hover:bg-white/10',
				)}
				onClick={(e) => {
					// prevent navigating into /Network
					e.stopPropagation()

					// open the add network share dialog
					navigate({search: addLinkSearchParams({dialog: 'files-add-network-share'})})
				}}
			>
				<button className='flex items-center justify-center text-white/60 transition-colors group-hover/plus:text-white'>
					<FaPlus className='size-3' strokeWidth={5} />
				</button>
			</div>
		</Droppable>
	)
}
