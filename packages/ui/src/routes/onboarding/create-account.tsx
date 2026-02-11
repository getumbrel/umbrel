import {useState} from 'react'
import {useNavigate} from 'react-router-dom'

import {AnimatedInputError, Input, PasswordInput} from '@/components/ui/input'
import {useDeviceInfo} from '@/hooks/use-device-info'
import {useLanguage} from '@/hooks/use-language'
import {formGroupClass, Layout, primaryButtonProps} from '@/layouts/bare/shared'
import {useAuth} from '@/modules/auth/use-auth'
import {OnboardingAction, OnboardingFooter} from '@/routes/onboarding/onboarding-footer'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

// Credentials for Umbrel Pro RAID flow. Passed via React Router's location.state
// through the RAID setup pages. Actual user.register call happens in setup.tsx
// after RAID configuration. location.state survives page refresh but is lost on
// direct URL navigation or new tab.
export type AccountCredentials = {
	name: string
	password: string
	language: string
}

export default function CreateAccount() {
	const title = t('onboarding.create-account')
	const navigate = useNavigate()
	const auth = useAuth()
	const [language] = useLanguage()
	const {data: deviceInfo} = useDeviceInfo()

	const [name, setName] = useState('')
	const [password, setPassword] = useState('')
	const [confirmPassword, setConfirmPassword] = useState('')
	const [localError, setLocalError] = useState('')
	const [isNavigating, setIsNavigating] = useState(false)

	const isPro = deviceInfo?.umbrelHostEnvironment === 'umbrel-pro'

	const loginMut = trpcReact.user.login.useMutation({
		onSuccess: async (jwt) => {
			setIsNavigating(true)
			auth.signUpWithJwt(jwt, '/onboarding/account-created')
		},
	})

	const registerMut = trpcReact.user.register.useMutation({
		onSuccess: async () => loginMut.mutate({password, totpToken: ''}),
	})

	const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()

		// Reset errors
		registerMut.reset()
		setLocalError('')

		if (!name) {
			setLocalError(t('onboarding.create-account.failed.name-required'))
			return
		}

		if (password !== confirmPassword) {
			setLocalError(t('onboarding.create-account.failed.passwords-dont-match'))
			return
		}

		if (password.length < 6) {
			setLocalError(t('change-password.failed.min-length', {characters: 6}))
			return
		}

		if (isPro) {
			// For Umbrel Pro we navigate to RAID setup
			setIsNavigating(true)
			const credentials: AccountCredentials = {name, password, language}

			// Pass credentials to RAID setup page
			navigate('/onboarding/raid', {state: {credentials}})
		} else {
			// For non-Pro devices we do standard registration flow
			registerMut.mutate({name, password, language})
		}
	}

	const remoteFormError = !registerMut.error?.data?.zodError && registerMut.error?.message
	const formError = localError || remoteFormError
	const isLoading = registerMut.isPending || loginMut.isPending || isNavigating

	return (
		<Layout
			title={title}
			subTitle={t('onboarding.create-account.subtitle')}
			subTitleMaxWidth={630}
			footer={<OnboardingFooter action={OnboardingAction.RESTORE} />}
		>
			<form onSubmit={onSubmit} className='w-full'>
				<fieldset disabled={isLoading} className='flex flex-col items-center gap-5'>
					<div className={formGroupClass}>
						<Input
							placeholder={t('onboarding.create-account.name.input-placeholder')}
							autoFocus
							value={name}
							onValueChange={setName}
						/>
						<PasswordInput
							label={t('onboarding.create-account.password.input-label')}
							value={password}
							onValueChange={setPassword}
							error={registerMut.error?.data?.zodError?.fieldErrors['password']?.join('. ')}
						/>
						<PasswordInput
							label={t('onboarding.create-account.confirm-password.input-label')}
							value={confirmPassword}
							onValueChange={setConfirmPassword}
						/>
					</div>

					<div className='-my-2.5'>
						<AnimatedInputError>{formError}</AnimatedInputError>
					</div>
					<button type='submit' {...primaryButtonProps}>
						{isLoading ? t('onboarding.create-account.submitting') : t('onboarding.create-account.submit')}
					</button>
				</fieldset>
			</form>
		</Layout>
	)
}
