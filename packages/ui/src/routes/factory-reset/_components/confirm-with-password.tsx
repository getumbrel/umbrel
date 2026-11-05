import {useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {TbAlertTriangle} from 'react-icons/tb'
import {useMount} from 'react-use'

import {WarningAlert} from '@/components/ui/alert'
import {Button} from '@/components/ui/button'
import {ImmersiveDialogBody} from '@/components/ui/immersive-dialog'
import {PasswordInput} from '@/components/ui/input'

import {description, title} from './misc'

export function ConfirmWithPassword({
	error,
	onSubmit,
	clearError,
}: {
	error: string
	onSubmit: (password: string) => void
	clearError: () => void
}) {
	const {t} = useTranslation()
	const passwordRef = useRef<HTMLInputElement>(null)
	const [password, setPassword] = useState('')

	// Clear password and errors so we don't see it when we come back to this page
	useMount(() => {
		setPassword('')
		clearError()
	})

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()
		onSubmit(password)
		setPassword('')
	}

	return (
		<form onSubmit={handleSubmit} className='flex-1'>
			<ImmersiveDialogBody
				title={title()}
				description={description()}
				bodyText={t('factory-reset.confirm.body')}
				footer={
					<>
						<Button type='submit' variant='destructive' size='dialog' className='min-w-0'>
							{t('factory-reset.confirm.submit')}
						</Button>
						<div className='text-13 text-destructive2'>{t('factory-reset.confirm.submit-callout')}</div>
					</>
				}
			>
				<label>
					<PasswordInput
						autoFocus
						inputRef={passwordRef}
						sizeVariant='short'
						value={password}
						onValueChange={setPassword}
						error={error}
					/>
				</label>
				<WarningAlert
					icon={TbAlertTriangle}
					description={t('factory-reset.confirm.ethernet-required-warning')}
					className='mt-5'
				/>
			</ImmersiveDialogBody>
		</form>
	)
}
