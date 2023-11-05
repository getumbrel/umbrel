import {useState} from 'react'
import {Link} from 'react-router-dom'

import {links} from '@/constants/links'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {buttonClass, formGroupClass, Layout} from '@/layouts/bare/shared'
import {useAuth} from '@/modules/auth/use-auth'
import {PasswordInput} from '@/shadcn-components/ui/input'
import {trpcReact} from '@/trpc/trpc'

export function Login() {
	useUmbrelTitle('Login')

	const {loginWithJwt} = useAuth()

	const loginMut = trpcReact.user.login.useMutation({
		onSuccess: loginWithJwt,
	})

	const [password, setPassword] = useState('')

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()
		loginMut.mutate({password, totpToken: ''})
	}

	return (
		<Layout
			title='Welcome back'
			subTitle='Enter your Umbrel password to log in'
			footer={
				<Link to={links.support} target='_blank'>
					Contact support
				</Link>
			}
		>
			<form className='flex w-full flex-col items-center gap-5' onSubmit={handleSubmit}>
				<div className={formGroupClass}>
					<PasswordInput
						label='Password'
						autoFocus
						value={password}
						onValueChange={setPassword}
						error={loginMut.error?.message}
					/>
				</div>
				<button type='submit' className={buttonClass}>
					Log in
				</button>
			</form>
		</Layout>
	)
}
