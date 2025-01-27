import {useLocation, useNavigate} from 'react-router-dom'

import {SidebarItem} from '@/features/files/components/sidebar/sidebar-item'
import {BASE_ROUTE_PATH, RECENTS_PATH} from '@/features/files/constants'
import {t} from '@/utils/i18n'

export function SidebarRecents() {
	const navigate = useNavigate()
	const {pathname} = useLocation()

	return (
		<SidebarItem
			item={{
				name: t('files-sidebar.recents'),
				path: RECENTS_PATH,
				type: 'directory',
			}}
			isActive={pathname === `${BASE_ROUTE_PATH}${RECENTS_PATH}`}
			onClick={() => navigate(`${BASE_ROUTE_PATH}${RECENTS_PATH}`)}
		/>
	)
}
