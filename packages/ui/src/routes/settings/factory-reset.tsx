import {useRef, useState} from 'react'
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
import {AnimatedInputError, Input} from '@/shadcn-components/ui/input'
import {trpcReact} from '@/trpc/trpc'
import {useAfterDelayedClose} from '@/utils/dialog'

export default function FactoryResetDialog() {
	const title = 'Factory reset'
	useUmbrelTitle(title)
	const navigate = useNavigate()

	const [open, setOpen] = useState(true)

	useAfterDelayedClose(open, () => navigate('/settings', {preventScrollReset: true}))

	const [name, setName] = useState('')
	const nameInputRef = useRef<HTMLInputElement>(null)
	const [localError, setLocalError] = useState('')
	const userQ = trpcReact.user.get.useQuery()

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()

		if (!userQ.data?.name) {
			throw new Error('User name could not be found')
		}

		if (!name) {
			setLocalError('Name is required')
			return
		}

		if (name !== userQ.data.name) {
			setLocalError('Device name is incorrect')
			setName('')
			nameInputRef.current?.focus()
		} else {
			setLocalError('')
			// Delay to allow
			setTimeout(() => {
				navigate('/factory-reset')
			}, 300)
		}
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogPortal>
				<DialogContent asChild>
					<form onSubmit={handleSubmit}>
						<DialogCloseButton className='absolute right-2 top-2 z-50' />
						<DialogHeader>
							<DialogTitle>{title}</DialogTitle>
							<DialogDescription>
								Are you sure you want to perform a factory reset? Enter your device name below to get started.
							</DialogDescription>
						</DialogHeader>
						<Input ref={nameInputRef} autoFocus placeholder='Device name' value={name} onValueChange={setName} />
						<div className='-my-2.5'>
							<AnimatedInputError>{localError}</AnimatedInputError>
						</div>
						<DialogFooter>
							<Button type='submit' size='dialog' variant='primary'>
								Proceed
							</Button>
							<Button onClick={() => setOpen(false)} size='dialog'>
								Not now
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</DialogPortal>
		</Dialog>
	)
}
