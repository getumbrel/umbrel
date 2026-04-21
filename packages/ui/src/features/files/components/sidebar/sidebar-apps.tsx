import {useTranslation} from 'react-i18next'

import {SidebarItem} from '@/features/files/components/sidebar/sidebar-item'
import {APPS_PATH} from '@/features/files/constants'
import {useNavigate as useFilesNavigate} from '@/features/files/hooks/use-navigate'

export function SidebarApps() {
	const {t} = useTranslation()
	const {navigateToDirectory, currentPath} = useFilesNavigate()

	return (
		<SidebarItem
			item={{
				name: t('files-sidebar.apps'),
				path: APPS_PATH,
				type: 'directory',
			}}
			isActive={currentPath === APPS_PATH}
			onClick={() => navigateToDirectory(APPS_PATH)}
		/>
	)
}
