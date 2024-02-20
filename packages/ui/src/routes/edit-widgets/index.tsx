import {useState} from 'react'
import {useNavigate} from 'react-router-dom'

import {UmbrelHeadTitle} from '@/components/umbrel-head-title'
import {afterDelayedClose} from '@/utils/dialog'
import {t} from '@/utils/i18n'

import {WidgetSelector} from './widget-selector'

export default function EditWidgetsPage() {
	const title = t('widgets.edit.title')
	const navigate = useNavigate()
	const [open, setOpen] = useState(true)

	return (
		<>
			<UmbrelHeadTitle>{title}</UmbrelHeadTitle>
			<WidgetSelector
				open={open}
				onOpenChange={(open) => {
					setOpen(open)
					afterDelayedClose(() => navigate('/'))(open)
				}}
			/>
		</>
	)
}
