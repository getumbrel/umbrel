import {usePassword} from '@/hooks/use-password'
import {ChangePasswordWarning, useSettingsDialogProps} from '@/routes/settings/_components/shared'
import {Button} from '@/shadcn-components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogPortal,
	DialogTitle,
} from '@/shadcn-components/ui/dialog'
import {AnimatedInputError, PasswordInput} from '@/shadcn-components/ui/input'
import {t} from '@/utils/i18n'

export default function ChangePasswordDialog() {
	const title = t('change-password')

	const dialogProps = useSettingsDialogProps()

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
							</DialogHeader>
							<ChangePasswordWarning />
							<PasswordInput
								label={t('change-password.current-password')}
								value={password}
								onValueChange={setPassword}
								error={fieldErrors.oldPassword}
							/>
							<PasswordInput
								label={t('change-password.new-password')}
								value={newPassword}
								onValueChange={setNewPassword}
								error={fieldErrors.newPassword}
							/>
							<PasswordInput
								label={t('change-password.repeat-password')}
								value={newPasswordRepeat}
								onValueChange={setNewPasswordRepeat}
							/>
							<div className='-my-2.5'>
								<AnimatedInputError>{formError}</AnimatedInputError>
							</div>
							<DialogFooter>
								<Button type='submit' size='dialog' variant='primary'>
									{t('confirm')}
								</Button>
								<Button type='button' size='dialog' onClick={() => dialogProps.onOpenChange(false)}>
									{t('cancel')}
								</Button>
							</DialogFooter>
						</fieldset>
					</form>
				</DialogContent>
			</DialogPortal>
		</Dialog>
	)
}
