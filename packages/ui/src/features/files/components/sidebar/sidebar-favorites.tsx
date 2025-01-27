import {AnimatePresence, motion} from 'framer-motion'

import {SidebarItem} from '@/features/files/components/sidebar/sidebar-item'
import {useFavorites} from '@/features/files/hooks/use-favorites'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {Favorite} from '@/features/files/types'
import {ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger} from '@/shadcn-components/ui/context-menu'
import {t} from '@/utils/i18n'

export function SidebarFavorites({favorites}: {favorites: Favorite[]}) {
	const {navigateToDirectory, currentPath} = useNavigate()
	const {removeFavorite} = useFavorites()

	return (
		<AnimatePresence initial={false}>
			{favorites.map((favorite: Favorite) => (
				<motion.div
					key={`sidebar-favorite-${favorite.path}`}
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
										name: favorite.name,
										path: favorite.path,
										type: 'directory',
									}}
									isActive={currentPath === favorite.path}
									onClick={() => navigateToDirectory(favorite.path)}
								/>
							</div>
						</ContextMenuTrigger>
						<ContextMenuContent>
							<ContextMenuItem onClick={() => removeFavorite({path: favorite.path})}>
								{t('files-action.remove-favorite')}
							</ContextMenuItem>
						</ContextMenuContent>
					</ContextMenu>
				</motion.div>
			))}
		</AnimatePresence>
	)
}
