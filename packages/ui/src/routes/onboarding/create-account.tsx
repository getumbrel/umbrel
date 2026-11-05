import {AnimatePresence, motion} from 'motion/react'
import {useEffect, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {FaLock} from 'react-icons/fa6'
import {useLocation, useNavigate} from 'react-router-dom'

import {AnimatedInputError, Input, PasswordInput} from '@/components/ui/input'
import {deviceInfoToHostEnvironment, useDeviceInfo} from '@/hooks/use-device-info'
import {useLanguage} from '@/hooks/use-language'
import {formGroupClass, Layout, primaryButtonProps} from '@/layouts/bare/shared'
import {useAuth} from '@/modules/auth/use-auth'
import {OnboardingAction, OnboardingFooter} from '@/routes/onboarding/onboarding-footer'
import {trpcReact} from '@/trpc/trpc'

import {getGenericRaidOnboardingPath} from './storage-selection'

// Credentials for RAID onboarding flows. Passed via React Router's location.state
// through the RAID setup pages. Actual user.register call happens in setup.tsx
// after RAID configuration. location.state survives page refresh but is lost on
// direct URL navigation or new tab.
const MIN_PASSWORD_LENGTH = 6

export type AccountCredentials = {
	name: string
	password: string
	language: string
}

export default function CreateAccount() {
	const {t} = useTranslation()
	const title = t('onboarding.create-account')
	const navigate = useNavigate()
	const auth = useAuth()
	const [language] = useLanguage()
	const utils = trpcReact.useUtils()
	const deviceInfoQ = useDeviceInfo()
	const {data: deviceInfo, isLoading: isDeviceInfoLoading} = deviceInfoQ
	const [isCheckingStorage, setIsCheckingStorage] = useState(false)

	const [name, setName] = useState('')
	const [password, setPassword] = useState('')
	const [confirmPassword, setConfirmPassword] = useState('')
	const [localError, setLocalError] = useState('')
	const [isNavigating, setIsNavigating] = useState(false)

	const isRaspberryPi = deviceInfo?.umbrelHostEnvironment === 'raspberry-pi'
	const isGeneric = deviceInfo?.umbrelHostEnvironment === 'unknown'

	// A Raspberry Pi with an external drive attached chooses where its data lives
	// in the external-drive step first. Arriving from that step (SD card chosen)
	// sets this flag; landing here any other way redirects to the step.
	const location = useLocation()
	const externalDriveAcknowledged = !!location.state?.externalDriveAcknowledged
	const checkExternalDrives = isRaspberryPi && !externalDriveAcknowledged
	const externalDevicesQ = trpcReact.files.externalDevices.useQuery(undefined, {enabled: checkExternalDrives})
	useEffect(() => {
		if (checkExternalDrives && externalDevicesQ.data?.length) {
			navigate('/onboarding/external-drive', {replace: true})
		}
	}, [checkExternalDrives, externalDevicesQ.data, navigate])
	// Generic devices with internal data drives get the matching RAID onboarding flow
	const internalStorageQ = trpcReact.hardware.internalStorage.getDevices.useQuery(undefined, {enabled: isGeneric})

	const loginMut = trpcReact.user.login.useMutation({
		onSuccess: async (token) => {
			setIsNavigating(true)
			auth.signUpWithToken(token, '/onboarding/account-created')
		},
	})

	const registerMut = trpcReact.user.register.useMutation({
		onSuccess: async () => loginMut.mutate({password, totpToken: ''}),
	})

	const completeAccountSetup = async () => {
		setIsCheckingStorage(true)
		try {
			const identity = await utils.client.systemNg.device.getIdentity.query()
			const host = deviceInfoToHostEnvironment(identity)
			if (!host) throw new Error('Storage identity unavailable')
			let path: string | undefined
			if (host === 'umbrel-pro') path = '/onboarding/raid'
			if (host === 'unknown') {
				const inventory = await internalStorageQ.refetch()
				if (inventory.isError || !inventory.data) throw new Error('Storage inventory unavailable')
				path = getGenericRaidOnboardingPath(inventory.data) ?? undefined
			}
			if (host === 'raspberry-pi' && !externalDriveAcknowledged) {
				const external = await externalDevicesQ.refetch()
				if (external.isError || !external.data) throw new Error('External storage unavailable')
				if (external.data.length) {
					navigate('/onboarding/external-drive', {replace: true})
					return
				}
			}
			if (path) {
				setIsNavigating(true)
				const credentials: AccountCredentials = {name: name.trim(), password, language}
				navigate(path, {state: {credentials}})
				return
			}
			registerMut.mutate({name: name.trim(), password, language})
		} catch {
			setLocalError(t('storage-status.check-failed'))
		} finally {
			setIsCheckingStorage(false)
		}
	}

	// An error is about what was submitted, so it goes as soon as a field changes
	const clearErrors = () => {
		setLocalError('')
		registerMut.reset()
	}
	const onFieldChange = (setValue: (value: string) => void) => (value: string) => {
		setValue(value)
		clearErrors()
	}

	const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()
		clearErrors()

		// A name of only spaces would leave the account blank everywhere it's shown
		if (!name.trim()) {
			setLocalError(t('onboarding.create-account.failed.name-required'))
			return
		}

		if (password !== confirmPassword) {
			setLocalError(t('onboarding.create-account.failed.passwords-dont-match'))
			return
		}

		if (password.length < MIN_PASSWORD_LENGTH) {
			setLocalError(t('change-password.failed.min-length', {characters: MIN_PASSWORD_LENGTH}))
			return
		}

		completeAccountSetup()
	}

	const remoteFormError = !registerMut.error?.data?.zodError && registerMut.error?.message
	const formError = localError || remoteFormError
	// Only worth warning about a password once there's a valid, confirmed one
	const isPasswordConfirmed = password.length >= MIN_PASSWORD_LENGTH && confirmPassword === password
	const isLoading =
		isDeviceInfoLoading || isCheckingStorage || registerMut.isPending || loginMut.isPending || isNavigating

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
							onValueChange={onFieldChange(setName)}
						/>
						<PasswordInput
							label={t('onboarding.create-account.password.input-label')}
							value={password}
							onValueChange={onFieldChange(setPassword)}
							error={registerMut.error?.data?.zodError?.fieldErrors['password']?.join('. ')}
						/>
						<PasswordInput
							label={t('onboarding.create-account.confirm-password.input-label')}
							value={confirmPassword}
							onValueChange={onFieldChange(setConfirmPassword)}
						/>
					</div>

					{/* There is no password reset, so the warning sits with the fields rather than in the
						subtitle, and only once there's a password worth backing up. It sits outside the form
						group so it can run wider than the inputs and stay on one line. */}
					<AnimatePresence initial={false}>
						{isPasswordConfirmed && (
							<motion.div
								className='-mt-1.5 w-full overflow-hidden'
								initial={{height: 0, opacity: 0}}
								animate={{height: 'auto', opacity: 1}}
								exit={{height: 0, opacity: 0}}
								transition={{duration: 0.35, ease: [0.16, 1, 0.3, 1]}}
							>
								{/* A light sweeps left to right across the text once as it arrives. The lock is inline
									rather than a flex item so it hugs the first word when the text wraps on narrow
									screens, and `align` centres it on the cap height. */}
								<p className='px-4 py-1 text-center text-12 leading-4 font-medium -tracking-3 text-balance'>
									<FaLock className='mr-1.5 inline-block size-[11px] align-[-0.1em] text-white/40' />
									<span className='animate-text-shine bg-[linear-gradient(90deg,rgba(255,255,255,0.45)_0%,rgba(255,255,255,0.45)_40%,rgba(255,255,255,1)_50%,rgba(255,255,255,0.45)_60%,rgba(255,255,255,0.45)_100%)] bg-[length:300%_100%] bg-clip-text bg-no-repeat text-transparent'>
										{t('onboarding.create-account.password-note')}
									</span>
								</p>
							</motion.div>
						)}
					</AnimatePresence>

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
