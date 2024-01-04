import {useRef} from 'react'
import {useNavigate} from 'react-router-dom'

import {ImmersiveDialogBody} from '@/components/ui/immersive-dialog'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {Button} from '@/shadcn-components/ui/button'
import {PasswordInput} from '@/shadcn-components/ui/input'
import {trpcReact} from '@/trpc/trpc'

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
	useUmbrelTitle(factoryResetTitle('Confirm with password'))
	const navigate = useNavigate()

	const passwordRef = useRef<HTMLInputElement>(null)

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()
		await mut.mutateAsync({password})
		navigate('/factory-reset/resetting')
	}

	return (
		<form onSubmit={handleSubmit} className='flex-1'>
			<ImmersiveDialogBody
				title={title}
				description={description}
				bodyText='Confirm Umbrel password to begin resetting'
				footer={
					<>
						<Button type='submit' variant='destructive' size='dialog' className='min-w-0'>
							Erase everything & reset
						</Button>
						<div className='text-13 text-destructive2'>This action cannot be undone.</div>
					</>
				}
			>
				<label>
					<div className='mb-1 text-14 leading-tight'>Enter password</div>
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
