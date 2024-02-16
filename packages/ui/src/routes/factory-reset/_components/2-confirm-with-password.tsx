import {useRef} from 'react'
import {useNavigate} from 'react-router-dom'
import {useMount} from 'react-use'

import {ImmersiveDialogBody} from '@/components/ui/immersive-dialog'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {Button} from '@/shadcn-components/ui/button'
import {PasswordInput} from '@/shadcn-components/ui/input'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

import {description, factoryResetTitle, title} from './misc'

export function ConfirmWithPassword({
	password,
	onPasswordChange,
	mut,
}: {
	password: string
	onPasswordChange: (password: string) => void
	mut: ReturnType<typeof trpcReact.system.factoryReset.useMutation>
}) {
	useUmbrelTitle(factoryResetTitle(t('factory-reset.confirm.title')))
	const navigate = useNavigate()

	const passwordRef = useRef<HTMLInputElement>(null)

	// Clear password and errors so we don't see it when we come back to this page
	useMount(() => {
		onPasswordChange('')
		mut.reset()
	})

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()
		await mut.mutateAsync({password})
		navigate('/factory-reset/resetting')
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
					<div className='mb-1 text-14 leading-tight'>{t('factory-reset.confirm.password-label')}</div>
					<PasswordInput
						autoFocus
						inputRef={passwordRef}
						sizeVariant='short'
						value={password}
						onValueChange={onPasswordChange}
						error={mut.error?.message}
					/>
				</label>
			</ImmersiveDialogBody>
		</form>
	)
}
