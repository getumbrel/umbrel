import {useState} from 'react'
import {useNavigate} from 'react-router-dom'

import {DialogCloseButton} from '@/components/ui/dialog-close-button'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {Button} from '@/shadcn-components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogPortal,
	DialogTitle,
} from '@/shadcn-components/ui/dialog'
import {Input} from '@/shadcn-components/ui/input'
import {useAfterDelayedClose} from '@/utils/dialog'

export default function FactoryResetDialog() {
	const title = 'Factory reset'
	useUmbrelTitle(title)
	const navigate = useNavigate()

	const [open, setOpen] = useState(true)

	useAfterDelayedClose(open, () => navigate('/settings', {preventScrollReset: true}))

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogPortal>
				<DialogContent>
					<DialogCloseButton className='absolute right-2 top-2 z-50' />
					<DialogHeader>
						<DialogTitle>{title}</DialogTitle>
						<DialogDescription>
							Are you sure you want to perform a factory reset? Enter your device name below to get started.
						</DialogDescription>
					</DialogHeader>
					<Input placeholder='Device name' />
					<DialogFooter>
						<Button size='dialog' variant='primary'>
							Proceed
						</Button>
						<Button size='dialog'>Not now</Button>
					</DialogFooter>
				</DialogContent>
			</DialogPortal>
		</Dialog>
	)
}
