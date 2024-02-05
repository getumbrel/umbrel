import {RiAlarmWarningFill} from 'react-icons/ri'

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
import {useDialogOpenProps} from '@/utils/dialog'

import {usePassword} from '../../hooks/use-password'
import {NoForgotPasswordMessage} from './_components/no-forgot-password-message'

export default function ChangePasswordDialog() {
	const title = 'Change password'
	useUmbrelTitle(title)

	const dialogProps = useDialogOpenProps('change-password')

	const {
		password,
		setPassword,
		newPassword,
		setNewPassword,
		newPasswordRepeat,
		setNewPasswordRepeat,
		handleSubmit,
		fieldErrors,
		formError,
		isLoading,
	} = usePassword({
		onSuccess: () => dialogProps.onOpenChange(false),
	})

	return (
		<Dialog {...dialogProps}>
			<DialogPortal>
				<DialogContent asChild>
					<form onSubmit={handleSubmit}>
						<fieldset disabled={isLoading} className='flex flex-col gap-5'>
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
								error={fieldErrors.oldPassword}
							/>
							<PasswordInput
								label='New password'
								value={newPassword}
								onValueChange={setNewPassword}
								error={fieldErrors.newPassword}
							/>
							<PasswordInput label='Repeat password' value={newPasswordRepeat} onValueChange={setNewPasswordRepeat} />
							<div className='-my-2.5'>
								<AnimatedInputError>{formError}</AnimatedInputError>
							</div>
							<NoForgotPasswordMessage />
							<DialogFooter>
								<Button type='submit' size='dialog' variant='primary'>
									Change password
								</Button>
								<Button type='button' size='dialog' onClick={() => dialogProps.onOpenChange(false)}>
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
