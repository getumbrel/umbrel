import {useEffect, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {TbCircleCheckFilled} from 'react-icons/tb'
import {RiRestartLine, RiShutDownLine} from 'react-icons/ri'
import {useLocation} from 'react-router-dom'

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {PasswordInput} from '@/components/ui/input'
import {PinInput} from '@/components/ui/pin-input'
import {formGroupClass, Layout, primaryButtonProps, secondaryButtonClasss} from '@/layouts/bare/shared'
import {cn} from '@/lib/utils'
import {useAuth} from '@/modules/auth/use-auth'
import {useGlobalSystemState} from '@/providers/global-system-state/index'
import {trpcReact} from '@/trpc/trpc'

type Step = 'password' | '2fa'
type PowerStep = 'password' | '2fa'
type PowerAction = 'shutdown' | 'restart'

export default function Login() {
	const {t} = useTranslation()
	const [password, setPassword] = useState('')
	const [step, setStep] = useState<Step>('password')

	// Show a confirmation dialog when arriving from the static IP confirmation flow
	const location = useLocation()
	const confirmedIp = (location.state as {confirmedIp?: string} | null)?.confirmedIp
	const [showConfirmDialog, setShowConfirmDialog] = useState(!!confirmedIp)

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
		loginMut.mutate({password})
	}

	const handleSubmit2fa = async (totpToken: string) => {
		const res = await loginMut.mutateAsync({password, totpToken})
		return !!res
	}

	const confirmDialog = showConfirmDialog && confirmedIp && (
		<AlertDialog open>
			<AlertDialogContent onEscapeKeyDown={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()}>
				<AlertDialogHeader icon={TbCircleCheckFilled}>
					<AlertDialogTitle>{t('confirm-static-ip.success-title', {ip: confirmedIp})}</AlertDialogTitle>
					<AlertDialogDescription>{t('confirm-static-ip.success-description')}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogAction onClick={() => setShowConfirmDialog(false)}>{t('ok')}</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)

	const powerFooter = (
		<>
			<PowerActionDialog action='restart' />
			<PowerActionDialog action='shutdown' />
		</>
	)

	switch (step) {
		case 'password': {
			return (
				<>
					<Layout title={t('login.title')} subTitle={t('login.subtitle')} footer={powerFooter}>
						<form className='flex w-full flex-col items-center gap-5 px-4 md:px-0' onSubmit={handleSubmitPassword}>
							<div className={cn(formGroupClass, 'max-w-[280px]')}>
								<PasswordInput
									label={t('login.password-label')}
									autoFocus
									value={password}
									onValueChange={setPassword}
									error={loginMut.error?.message}
								/>
							</div>
							<button type='submit' {...primaryButtonProps}>
								{t('login.password.submit')}
							</button>
						</form>
					</Layout>
					{confirmDialog}
				</>
			)
		}
		case '2fa': {
			return (
				<>
					<Layout title={t('login-2fa.title')} subTitle={t('login-2fa.subtitle')} footer={powerFooter}>
						<form className='flex w-full flex-col items-center gap-5 px-4 md:px-0' onSubmit={handleSubmitPassword}>
							<PinInput autoFocus length={6} onCodeCheck={handleSubmit2fa} />
						</form>
					</Layout>
					{confirmDialog}
				</>
			)
		}
	}
}

function PowerActionDialog({action}: {action: PowerAction}) {
	const {t} = useTranslation()
	const {shutdownWithPassword, restartWithPassword} = useGlobalSystemState()
	const powerAction = action === 'shutdown' ? shutdownWithPassword : restartWithPassword
	const [open, setOpen] = useState(false)
	const [step, setStep] = useState<PowerStep>('password')
	const [password, setPassword] = useState('')
	const [passwordError, setPasswordError] = useState('')
	const [isPending, setIsPending] = useState(false)

	useEffect(() => {
		if (!open) {
			setStep('password')
			setPassword('')
			setPasswordError('')
			setIsPending(false)
		}
	}, [open])

	const titleKey = action === 'shutdown' ? 'shut-down.confirm.title' : 'restart.confirm.title'
	const submitKey = action === 'shutdown' ? 'shut-down.confirm.submit' : 'restart.confirm.submit'
	const triggerKey = action === 'shutdown' ? 'shut-down' : 'restart'
	const ActionIcon = action === 'shutdown' ? RiShutDownLine : RiRestartLine

	const handlePasswordSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		if (!password) return
		setPasswordError('')
		setIsPending(true)
		try {
			await powerAction({password})
			setOpen(false)
		} catch (error) {
			const message = (error as {message?: string})?.message ?? ''
			if (message === 'Missing 2FA code') {
				setPasswordError('')
				setStep('2fa')
				return
			}
			setPasswordError(message || t('something-went-wrong'))
		} finally {
			setIsPending(false)
		}
	}

	const handleSubmit2fa = async (totpToken: string) => {
		try {
			await powerAction({password, totpToken})
			setOpen(false)
			return true
		} catch (error) {
			const message = (error as {message?: string})?.message ?? ''
			if (message === 'Incorrect password') {
				setPasswordError(message)
				setStep('password')
			}
			return false
		}
	}

	return (
		<AlertDialog open={open} onOpenChange={setOpen}>
			<AlertDialogTrigger asChild>
				<button className={secondaryButtonClasss} type='button'>
					{t(triggerKey)}
				</button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				{step === 'password' ? (
					<form className='flex flex-col gap-5' onSubmit={handlePasswordSubmit}>
						<AlertDialogHeader icon={ActionIcon}>
							<AlertDialogTitle>{t(titleKey)}</AlertDialogTitle>
						</AlertDialogHeader>
						<div className={cn(formGroupClass, 'mx-auto w-full max-w-[280px]')}>
							<PasswordInput
								autoFocus
								label={t('login.password-label')}
								value={password}
								onValueChange={(value) => {
									setPasswordError('')
									setPassword(value)
								}}
								error={passwordError}
							/>
						</div>
						<AlertDialogFooter>
							<AlertDialogAction variant='destructive' type='submit' disabled={!password || isPending}>
								{t(submitKey)}
							</AlertDialogAction>
							<AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
						</AlertDialogFooter>
					</form>
				) : (
					<div className='flex flex-col gap-5'>
						<AlertDialogHeader icon={ActionIcon}>
							<AlertDialogTitle>{t(titleKey)}</AlertDialogTitle>
							<AlertDialogDescription>{t('login-2fa.subtitle')}</AlertDialogDescription>
						</AlertDialogHeader>
						<div className='mx-auto'>
							<PinInput autoFocus length={6} onCodeCheck={handleSubmit2fa} />
						</div>
						<AlertDialogFooter>
							<AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
						</AlertDialogFooter>
					</div>
				)}
			</AlertDialogContent>
		</AlertDialog>
	)
}
