import {useState} from 'react'
import {useTranslation} from 'react-i18next'
import {TbCircleCheckFilled} from 'react-icons/tb'
import {useLocation} from 'react-router-dom'

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {PasswordInput} from '@/components/ui/input'
import {PinInput} from '@/components/ui/pin-input'
import {formGroupClass, Layout, primaryButtonProps} from '@/layouts/bare/shared'
import {cn} from '@/lib/utils'
import {useAuth} from '@/modules/auth/use-auth'
import {trpcReact} from '@/trpc/trpc'

type Step = 'password' | '2fa'

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

	switch (step) {
		case 'password': {
			return (
				<>
					<Layout title={t('login.title')} subTitle={t('login.subtitle')}>
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
					<Layout title={t('login-2fa.title')} subTitle={t('login-2fa.subtitle')}>
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
