import {AnimatePresence, motion} from 'framer-motion'

import {SidebarItem} from '@/features/files/components/sidebar/sidebar-item'
import {useFavorites} from '@/features/files/hooks/use-favorites'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger} from '@/shadcn-components/ui/context-menu'
import {t} from '@/utils/i18n'

export function SidebarFavorites({favorites}: {favorites: (string | null)[]}) {
	const {navigateToDirectory, currentPath} = useNavigate()
	const {removeFavorite} = useFavorites()

	return (
		<AnimatePresence initial={false}>
			{favorites.map((favoritePath: string | null) => {
				if (!favoritePath) return null
				const name = favoritePath.split('/').pop() || favoritePath

				return (
					<motion.div
						key={`sidebar-favorite-${favoritePath}`}
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
											name: name,
											path: favoritePath,
											type: 'directory',
										}}
										isActive={currentPath === favoritePath}
										onClick={() => navigateToDirectory(favoritePath)}
									/>
								</div>
							</ContextMenuTrigger>
							<ContextMenuContent>
								<ContextMenuItem onClick={() => removeFavorite({path: favoritePath})}>
									{t('files-action.remove-favorite')}
								</ContextMenuItem>
							</ContextMenuContent>
						</ContextMenu>
					</motion.div>
				)
			})}
		</AnimatePresence>
	)
}
