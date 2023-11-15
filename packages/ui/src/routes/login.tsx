import {useState} from 'react'
import {flushSync} from 'react-dom'

import {PinInput} from '@/components/ui/pin-input'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {buttonClass, formGroupClass, Layout} from '@/layouts/bare/shared'
import {useAuth} from '@/modules/auth/use-auth'
import {PasswordInput} from '@/shadcn-components/ui/input'
import {trpcReact} from '@/trpc/trpc'
import {transitionViewIfSupported} from '@/utils/misc'

type Step = 'password' | '2fa'

export function Login() {
	useUmbrelTitle('Login')

	const [password, setPassword] = useState('')
	const [step, setStep] = useState<Step>('password')

	const {loginWithJwt} = useAuth()

	const loginMut = trpcReact.user.login.useMutation({
		onSuccess: loginWithJwt,
		onError: (error) => {
			if (error.message === 'Missing 2FA token') {
				setStep('2fa')
			}
		},
	})

	const handleSubmitPassword = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()
		transitionViewIfSupported(() => {
			flushSync(() => {
				loginMut.mutate({password})
			})
		})
	}

	const handleSubmit2fa = async (totpToken: string) => {
		const res = await loginMut.mutateAsync({password, totpToken})
		return !!res
	}

	switch (step) {
		case 'password': {
			return (
				<Layout title='Welcome back' subTitle='Enter your Umbrel password to log in'>
					<form className='flex w-full flex-col items-center gap-5' onSubmit={handleSubmitPassword}>
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
		case '2fa': {
			return (
				<Layout title='Authenticate' subTitle='Enter the code displayed in your authenticator app'>
					<form className='flex w-full flex-col items-center gap-5' onSubmit={handleSubmitPassword}>
						<PinInput autoFocus length={6} onCodeCheck={handleSubmit2fa} />
					</form>
				</Layout>
			)
		}
	}
}
