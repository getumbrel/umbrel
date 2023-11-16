import {useState} from 'react'
import {RiAlarmWarningFill} from 'react-icons/ri'
import {useNavigate} from 'react-router-dom'

import {ErrorAlert} from '@/components/ui/alert'
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
import {AnimatedInputError, PasswordInput} from '@/shadcn-components/ui/input'
import {trpcReact} from '@/trpc/trpc'
import {useAfterDelayedClose} from '@/utils/dialog'
import {sleep} from '@/utils/misc'

export default function ChangePasswordDialog() {
	const title = 'Change password'
	useUmbrelTitle(title)

	const navigate = useNavigate()
	const [open, setOpen] = useState(true)

	useAfterDelayedClose(open, () => navigate('/settings', {preventScrollReset: true}))

	const [password, setPassword] = useState('')
	const [newPassword, setNewPassword] = useState('')
	const [newPasswordRepeat, setNewPasswordRepeat] = useState('')
	const [localError, setLocalError] = useState('')

	const changePasswordMut = trpcReact.user.changePassword.useMutation({
		onSuccess: async () => {
			await sleep(500)
			setOpen(false)
		},
	})

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()

		// Reset errors
		changePasswordMut.reset()
		setLocalError('')

		if (!password) {
			setLocalError('Current password is required')
			return
		}

		if (!newPassword) {
			setLocalError('New password is required')
			return
		}

		if (!newPasswordRepeat) {
			setLocalError('Repeat password is required')
			return
		}

		if (newPassword !== newPasswordRepeat) {
			setLocalError('Passwords do not match')
			return
		}

		if (password === newPassword) {
			setLocalError('New password must be different from current password')
			return
		}

		changePasswordMut.mutate({oldPassword: password, newPassword})
	}

	const remoteFormError = !changePasswordMut.error?.data?.zodError && changePasswordMut.error?.message
	const formError = localError || remoteFormError

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogPortal>
				<DialogContent asChild>
					<form onSubmit={handleSubmit}>
						<fieldset disabled={changePasswordMut.isLoading} className='flex flex-col gap-5'>
							<DialogHeader>
								<DialogTitle>{title}</DialogTitle>
								<DialogDescription>This is the password you use to unlock your Umbrel.</DialogDescription>
							</DialogHeader>
							<ErrorAlert
								icon={RiAlarmWarningFill}
								description='If you lose your password, you won’t be able to log in to your Umbrel for eternity.'
							/>
							<PasswordInput
								label='Current password'
								value={password}
								onValueChange={setPassword}
								error={changePasswordMut.error?.data?.zodError?.fieldErrors['oldPassword']?.join('. ')}
							/>
							<PasswordInput
								label='New password'
								value={newPassword}
								onValueChange={setNewPassword}
								error={changePasswordMut.error?.data?.zodError?.fieldErrors['newPassword']?.join('. ')}
							/>
							<PasswordInput label='Repeat password' value={newPasswordRepeat} onValueChange={setNewPasswordRepeat} />
							<div className='-my-2.5'>
								<AnimatedInputError>{formError}</AnimatedInputError>
							</div>
							<p className='text-12 font-normal leading-tight -tracking-2 text-white/40'>
								There is no ‘Forgot password’ button, so make sure you write down your{' '}
								<span className='text-success-light'>super strong</span> password somewhere.
							</p>
							<DialogFooter>
								<Button type='submit' size='dialog' variant='primary'>
									Change password
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
