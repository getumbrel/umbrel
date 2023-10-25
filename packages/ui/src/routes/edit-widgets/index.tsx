import {useState} from 'react'
import {useNavigate} from 'react-router-dom'
import {useLocalStorage} from 'react-use'

import {afterDelayedClose} from '@/components/client-layout'
import {WidgetConfig} from '@/components/desktop/widgets'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'

import {WidgetSelector} from './widget-selector'

export function EditWidgetsPage() {
	useUmbrelTitle('Edit widgets')
	const navigate = useNavigate()
	const [open, setOpen] = useState(true)

	// TODO: use a better storage mechanism
	// If we use trpc here to get the the data, we can also invalidate the query, triggering the desktop
	// to re-fetch the data. This would be a better solution than using local storage.
	const [selectedWidgets, setSelectedWidgets] = useLocalStorage<WidgetConfig[]>('selected-widgets', [])

	return (
		<WidgetSelector
			open={open}
			onOpenChange={(open) => {
				setOpen(open)
				afterDelayedClose(() => navigate('/'))(open)
			}}
			selectedWidgets={selectedWidgets}
			onSelectedWidgetsChange={setSelectedWidgets}
		/>
	)
}
