import {useState} from 'react'
import {flushSync} from 'react-dom'

import {PinInput} from '@/components/ui/pin-input'
import {buttonClass, formGroupClass, Layout} from '@/layouts/bare/shared'
import {useAuth} from '@/modules/auth/use-auth'
import {PasswordInput} from '@/shadcn-components/ui/input'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'
import {transitionViewIfSupported} from '@/utils/misc'

type Step = 'password' | '2fa'

export default function Login() {
	const [password, setPassword] = useState('')
	const [step, setStep] = useState<Step>('password')

	const {loginWithJwt} = useAuth()

	const loginMut = trpcReact.user.login.useMutation({
		onSuccess: loginWithJwt,
		onError: (error) => {
			if (error.message === 'Missing 2FA code') {
				setStep('2fa')
			} else {
				setPassword('')
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
				<Layout title={t('login.title')} subTitle={t('login.subtitle')}>
					<form className='flex w-full flex-col items-center gap-5 px-4 md:px-0' onSubmit={handleSubmitPassword}>
						<div className={formGroupClass}>
							<PasswordInput
								label={t('login.password-label')}
								autoFocus
								value={password}
								onValueChange={setPassword}
								error={loginMut.error?.message}
							/>
						</div>
						<button type='submit' className={buttonClass}>
							{t('login.password.submit')}
						</button>
					</form>
				</Layout>
			)
		}
		case '2fa': {
			return (
				<Layout title={t('login-2fa.title')} subTitle={t('login-2fa.subtitle')}>
					<form className='flex w-full flex-col items-center gap-5 px-4 md:px-0' onSubmit={handleSubmitPassword}>
						<PinInput autoFocus length={6} onCodeCheck={handleSubmit2fa} />
					</form>
				</Layout>
			)
		}
	}
}
