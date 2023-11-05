import {useState} from 'react'

import {ErrorAlert} from '@/components/ui/alert'
import {useAuth} from '@/modules/auth/use-auth'
import {Input} from '@/shadcn-components/ui/input'
import {trpcReact} from '@/trpc/trpc'

export function LoginTest() {
	const {loginWithJwt} = useAuth()
	const loginMut = trpcReact.user.login.useMutation({
		onSuccess: loginWithJwt,
	})

	const [password, setPassword] = useState('')

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()
		loginMut.mutate({password, totpToken: ''})
	}

	const registerMut = trpcReact.user.register.useMutation({
		onSuccess: () => {
			loginMut.mutate({password, totpToken: ''})
		},
	})

	return (
		<form className='flex w-full flex-col items-center gap-5' onSubmit={handleSubmit}>
			<div>
				<Input placeholder='Password' autoFocus value={password} onValueChange={setPassword} />
			</div>
			<button type='submit'>Log in</button>
			<button
				type='button'
				onClick={() => {
					registerMut.mutate({name: 'umbrel', password: 'umbrel'})
				}}
			>
				Create user
			</button>
			{loginMut.error && <ErrorAlert description={loginMut.error.message} />}
		</form>
	)
}
