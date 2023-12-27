import {useState} from 'react'
import {useNavigate} from 'react-router-dom'

import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {afterDelayedClose} from '@/utils/dialog'

import {WidgetSelector} from './widget-selector'

export default function EditWidgetsPage() {
	useUmbrelTitle('Edit widgets')
	const navigate = useNavigate()
	const [open, setOpen] = useState(true)

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
