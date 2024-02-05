import {ReactNode, useState} from 'react'
import {flushSync} from 'react-dom'
import {useParams} from 'react-router-dom'

import {AppIcon} from '@/components/app-icon'
import {PinInput} from '@/components/ui/pin-input'
import {useUserApp} from '@/hooks/use-apps'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {useAuth} from '@/modules/auth/use-auth'
import {Button} from '@/shadcn-components/ui/button'
import {PasswordInput} from '@/shadcn-components/ui/input'
import {cn} from '@/shadcn-lib/utils'
import {trpcReact} from '@/trpc/trpc'
import {transitionViewIfSupported} from '@/utils/misc'

type Step = 'password' | '2fa'

export default function LoginWithUmbrel() {
	useUmbrelTitle('Login with Umbrel')

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
				<LoginWithLayout>
					<form className='contents' onSubmit={handleSubmitPassword}>
						<PasswordInput
							label='Password'
							autoFocus
							value={password}
							onValueChange={setPassword}
							error={loginMut.error?.message}
						/>
						<div>
							<Button type='submit' variant={'primary'} size='lg' className='text-13'>
								Log in
							</Button>
						</div>
					</form>
				</LoginWithLayout>
			)
		}
		case '2fa': {
			return (
				<LoginWithLayout>
					<form className='contents' onSubmit={handleSubmitPassword}>
						<PinInput autoFocus length={6} onCodeCheck={handleSubmit2fa} />
					</form>
				</LoginWithLayout>
			)
		}
	}
}

function LoginWithLayout({children}: {children: ReactNode}) {
	const {appId} = useParams<{appId: string}>()
	const {isLoading, app} = useUserApp(appId)

	if (isLoading) {
		return null
	}

	if (!app) {
		throw new Error('App not found.')
	}

	return (
		<div className='flex h-full w-full flex-grow items-center justify-center'>
			<div
				className={cn(
					'w-full rounded-20 bg-dialog-content/70 p-8 shadow-dialog backdrop-blur-3xl sm:max-w-[480px]',
					'flex flex-col gap-5',
					'animate-in fade-in zoom-in-90',
				)}
			>
				<div className='flex h-0 -translate-y-[56px] gap-5'>
					<AppIcon src='/figma-exports/umbrel-ios.png' size={56} className='rounded-12' />
					<AppIcon src={app.icon} size={56} className='rounded-12' />
				</div>
				<div className='flex flex-col gap-1'>
					<h1 className='truncate text-17 font-semibold leading-tight -tracking-2'>Log in with Umbrel</h1>
					<p className='text-13 leading-tight -tracking-2 text-white/40'>
						Enter your Umbrel password to open {app.name}
					</p>
				</div>
				{children}
			</div>
		</div>
	)
}
