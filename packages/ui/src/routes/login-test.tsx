import {useState} from 'react'

import {ErrorAlert} from '@/components/ui/alert'
import {Input} from '@/shadcn-components/ui/input'
import {trpcReact} from '@/trpc/trpc'

export function LoginTest() {
	const loginMut = trpcReact.user.login.useMutation({
		onSuccess: (jwt) => {
			window.localStorage.setItem('jwt', jwt)
			// Hard navigate to `/` to force all parent layouts to re-render
			window.location.href = '/'
		},
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
				<Input placeholder='Password' autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
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
