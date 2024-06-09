import {useState} from 'react'
import {useNavigate} from 'react-router-dom'

import {useApps} from '@/providers/apps'
import {afterDelayedClose} from '@/utils/dialog'
import {t} from '@/utils/i18n'

import {WidgetSelector} from './widget-selector'

export default function EditWidgetsPage() {
	const navigate = useNavigate()
	const [open, setOpen] = useState(true)

	const {userApps, isLoading: isUserAppsLoading} = useApps()
	const hasInstalledApps = !isUserAppsLoading && (userApps ?? []).length > 0

	if (!hasInstalledApps) {
		return (
			<div className='absolute inset-0 grid h-full w-full place-items-center'>
				<div className='drop-shadow-desktop-label'>{t('widgets.install-an-app-before-using-widgets')}</div>
			</div>
		)
	}

	return (
		<WidgetSelector
			open={open}
			onOpenChange={(open) => {
				setOpen(open)
				afterDelayedClose(() => navigate('/'))(open)
			}}
		/>
	)
}
