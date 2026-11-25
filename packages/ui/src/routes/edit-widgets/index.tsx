import {useState} from 'react'

import {useNavigateAfterExit} from '@/utils/dialog'

import {WidgetSelector} from './widget-selector'

export default function EditWidgetsPage() {
	const [open, setOpen] = useState(true)
	useNavigateAfterExit(!open, '/')

	return <WidgetSelector open={open} onOpenChange={setOpen} />
}
