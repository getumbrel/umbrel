import {RiAlarmWarningFill} from 'react-icons/ri'

import {ErrorAlert} from '@/components/ui/alert'
import {usePassword} from '@/hooks/use-password'
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
import {t} from '@/utils/i18n'

import {NoForgotPasswordMessage} from './_components/no-forgot-password-message'

export default function ChangePasswordDialog() {
	const title = t('change-password')
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
								<DialogDescription>{t('change-password.description')}</DialogDescription>
							</DialogHeader>
							<ErrorAlert icon={RiAlarmWarningFill} description={t('change-password.callout')} />
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
							<NoForgotPasswordMessage />
							<DialogFooter>
								<Button type='submit' size='dialog' variant='primary'>
									{t('change-password.submit')}
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
