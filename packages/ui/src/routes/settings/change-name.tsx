import {useState} from 'react'
import {useNavigate} from 'react-router-dom'

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
import {sleep} from '@/utils/misc'

export default function ChangeNameDialog() {
	const title = 'Change name'
	useUmbrelTitle(title)
	const navigate = useNavigate()
	const [open, setOpen] = useState(true)

	useAfterDelayedClose(open, () => navigate('/settings', {preventScrollReset: true}))

	const [name, setName] = useState('')
	const [localError, setLocalError] = useState('')

	const ctx = trpcReact.useContext()

	const setMut = trpcReact.user.set.useMutation({
		onSuccess: async () => {
			await sleep(500)
			setOpen(false)
			ctx.user.get.invalidate()
		},
	})

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()

		// Reset errors
		setMut.reset()
		setLocalError('')

		if (!name) {
			setLocalError('Name is required')
			return
		}

		setMut.mutate({name})
	}

	const remoteFormError = !setMut.error?.data?.zodError && setMut.error?.message
	const formError = localError || remoteFormError

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogPortal>
				<DialogContent asChild>
					<form onSubmit={handleSubmit}>
						<fieldset disabled={setMut.isLoading} className='flex flex-col gap-5'>
							<DialogHeader>
								<DialogTitle>{title}</DialogTitle>
								<DialogDescription>This appears in the homescreen, and will be your device name too.</DialogDescription>
							</DialogHeader>
							<Input placeholder='Name' value={name} onValueChange={setName} />
							<div className='-my-2.5'>
								<AnimatedInputError>{formError}</AnimatedInputError>
							</div>
							<DialogFooter>
								<Button type='submit' size='dialog' variant='primary'>
									Save changes
								</Button>
								<Button type='button' size='dialog' onClick={() => setOpen(false)}>
									Cancel
								</Button>
							</DialogFooter>
						</fieldset>
					</form>
				</DialogContent>
			</DialogPortal>
		</Dialog>
	)
}
