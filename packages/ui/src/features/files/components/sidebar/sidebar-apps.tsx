import {useLocation, useNavigate} from 'react-router-dom'

import {SidebarItem} from '@/features/files/components/sidebar/sidebar-item'
import {APPS_PATH, BASE_ROUTE_PATH} from '@/features/files/constants'
import {t} from '@/utils/i18n'

export function SidebarApps() {
	const navigate = useNavigate()
	const {pathname} = useLocation()

	return (
		<SidebarItem
			item={{
				name: t('files-sidebar.apps'),
				path: APPS_PATH,
				type: 'directory',
			}}
			isActive={pathname === `${BASE_ROUTE_PATH}${APPS_PATH}`}
			onClick={() => navigate(`${BASE_ROUTE_PATH}${APPS_PATH}`)}
		/>
	)
}
