import {useNavigate as useRouterNavigate} from 'react-router-dom'

import {SidebarItem} from '@/features/files/components/sidebar/sidebar-item'
import {HOME_PATH} from '@/features/files/constants'
import {useHomeDirectoryName} from '@/features/files/hooks/use-home-directory-name'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {useShares} from '@/features/files/hooks/use-shares'
import {useQueryParams} from '@/hooks/use-query-params'
import {ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger} from '@/shadcn-components/ui/context-menu'
import {t} from '@/utils/i18n'

export function SidebarHome() {
	const homeDirectoryName = useHomeDirectoryName()
	const {navigateToDirectory, currentPath} = useNavigate()
	const navigate = useRouterNavigate()
	const {addLinkSearchParams} = useQueryParams()
	const {isHomeShared} = useShares()

	const isShared = isHomeShared()

	const openShareInfoDialog = () => {
		navigate({
			search: addLinkSearchParams({
				dialog: 'files-share-info',
				'files-share-info-name': homeDirectoryName,
				'files-share-info-path': HOME_PATH,
			}),
		})
	}

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<div>
					<SidebarItem
						item={{
							name: homeDirectoryName,
							path: HOME_PATH,
							type: 'directory',
						}}
						isActive={currentPath === HOME_PATH}
						onClick={() => navigateToDirectory(HOME_PATH)}
					/>
				</div>
			</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem onClick={openShareInfoDialog}>
					{isShared ? t('files-action.sharing') : t('files-action.share')}
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	)
}
