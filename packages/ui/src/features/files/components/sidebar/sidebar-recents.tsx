import {useLocation, useNavigate} from 'react-router-dom'

import {SidebarItem} from '@/features/files/components/sidebar/sidebar-item'
import {BASE_ROUTE_PATH, RECENTS_PATH} from '@/features/files/constants'
import {useIsFilesReadOnly} from '@/features/files/providers/files-capabilities-context'
import {t} from '@/utils/i18n'

export function SidebarRecents() {
	const navigate = useNavigate()
	const {pathname} = useLocation()
	// We disable (but still show) the recents sidebar item in read-only mode
	const isReadOnly = useIsFilesReadOnly()

	return (
		<SidebarItem
			item={{
				name: t('files-sidebar.recents'),
				path: RECENTS_PATH,
				type: 'directory',
			}}
			isActive={pathname === `${BASE_ROUTE_PATH}${RECENTS_PATH}`}
			onClick={() => navigate(`${BASE_ROUTE_PATH}${RECENTS_PATH}`)}
			disabled={isReadOnly}
		/>
	)
}
