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
import {PasswordInput} from '@/shadcn-components/ui/input'
import {useAfterDelayedClose} from '@/utils/dialog'

export function ChangePasswordDialog() {
	const title = 'Change password'
	useUmbrelTitle(title)

	const navigate = useNavigate()
	const [open, setOpen] = useState(true)

	useAfterDelayedClose(open, () => navigate('/settings', {preventScrollReset: true}))

	const [password, setPassword] = useState('')
	const [newPassword, setNewPassword] = useState('')
	const [newPasswordRepeat, setNewPasswordRepeat] = useState('')

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogPortal>
				<DialogContent asChild>
					<form
						onSubmit={async (e) => {
							e.preventDefault()
							alert('submit')
							setOpen(false)
						}}
					>
						<DialogHeader>
							<DialogTitle>{title}</DialogTitle>
							<DialogDescription>This is the password you use to unlock your Umbrel.</DialogDescription>
						</DialogHeader>
						<ErrorAlert
							icon={RiAlarmWarningFill}
							description='If you lose your password, you won’t be able to log in to your Umbrel for eternity.'
						/>
						<PasswordInput label='Current password' value={password} onValueChange={setPassword} />
						<PasswordInput label='New password' value={newPassword} onValueChange={setNewPassword} />
						<PasswordInput label='Repeat password' value={newPasswordRepeat} onValueChange={setNewPasswordRepeat} />
						<p className='text-12 font-normal leading-tight -tracking-2 text-white/40'>
							There is no ‘Forgot password’ button, so make sure you write down your{' '}
							<span className='text-success-light'>super strong</span> password somewhere.
						</p>
						<DialogFooter>
							<Button type='submit' size='dialog' variant='primary' onClick={() => setOpen(false)}>
								Change password
							</Button>
							<Button type='button' size='dialog' onClick={() => setOpen(false)}>
								Cancel
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</DialogPortal>
		</Dialog>
	)
}
