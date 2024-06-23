import {ReactNode, useEffect, useState} from 'react'
import {arrayIncludes} from 'ts-extras'

import {AppIcon} from '@/components/app-icon'
import {FadeInImg} from '@/components/ui/fade-in-img'
import {PinInput} from '@/components/ui/pin-input'
import {toast} from '@/components/ui/toast'
import {useQueryParams} from '@/hooks/use-query-params'
import {useWallpaperCssVars, WallpaperId, wallpaperIds} from '@/providers/wallpaper'
import {Button} from '@/shadcn-components/ui/button'
import {PasswordInput} from '@/shadcn-components/ui/input'
import {cn} from '@/shadcn-lib/utils'
import {t} from '@/utils/i18n'

type Step = 'password' | '2fa'

export default function LoginWithUmbrel() {
	const [password, setPassword] = useState('')
	const [step, setStep] = useState<Step>('password')

	const login = useLogin()

	const handleSubmitPassword = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()
		// alert('submit')
		try {
			const data = await login({password, totpToken: ''})
			if ('error' in data && data.error) {
				if (data.error.message === 'Missing 2FA code') {
					setStep('2fa')
				} else {
					toast.error(data.error.message)
				}
			}
		} catch (error: any) {
			if (error.message === 'Missing 2FA code') {
				setStep('2fa')
			} else {
				toast.error(error?.message)
			}
		}
	}

	// Specifying return because we want to ensure that the return type is a boolean for the `onCodeCheck` prop
	const handleSubmit2fa = async (totpToken: string): Promise<boolean> => {
		const data = await login({password, totpToken})

		return 'error' in data
	}

	switch (step) {
		case 'password': {
			return (
				<LoginWithLayout>
					<form className='contents' onSubmit={handleSubmitPassword}>
						{/* <JSONTree data={params.object} /> */}
						<PasswordInput
							label={t('login.password-label')}
							autoFocus
							value={password}
							onValueChange={setPassword}
							// error={loginMut.error?.message}
						/>
						<div>
							<Button type='submit' variant={'primary'} size='lg' className='text-13'>
								{t('login.password.submit')}
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

function useLogin() {
	// /v1/account/login

	const login = ({password, totpToken}: {password: string; totpToken: string}) => {
		// Forward the query params to the login endpoint
		return fetch('/v1/account/login' + document.location.search, {
			method: 'POST',
			headers: {'Content-Type': 'application/json'},
			body: JSON.stringify({password, totpToken}),
		}).then(async (res) => {
			const data = (await res.json()) as
				| {
						url: string
						params: {r: string; token: string; signature: string}
				  }
				| {error?: {code: number; message: string}}

			// 	{
			// 		"error": {
			// 				"message": "Missing 2FA code",
			// 				"code": -32001,
			// 				"data": {
			// 						"code": "UNAUTHORIZED",
			// 						"httpStatus": 401,
			// 						"stack": "TRPCError: Missing 2FA code...
			// 						"path": "user.login",
			// 						"zodError": null
			// 				}
			// 		}
			// }

			if ('url' in data) {
				// 	const json = {
				// 		"url": "http://localhost:3011/umbrel_/api/v1/auth/token",
				// 		"params": {
				// 				"r": "/",
				// 				"token": "eyJhbGciOiJI...",
				// 				"signature": "NUH1ZzFEeS..."
				// 		}
				// }

				const form = document.createElement('form')
				form.method = 'POST'
				form.action = data.url
				form.style.display = 'none'
				for (const [key, value] of Object.entries(data.params)) {
					const input = document.createElement('input')
					input.type = 'hidden'
					input.name = key
					input.value = value
					form.appendChild(input)
				}
				document.body.appendChild(form)
				form.submit()
			}

			return data
		})
	}

	return login
}

type App = {
	id: string
	icon: string
	name: string
}

function useApp(appId: string) {
	const [app, setApp] = useState<App>({id: '', icon: '', name: ''})

	// const [searchParams, setSearchParams] = useSearchParams()

	useEffect(() => {
		fetch(`/v1/apps?app=${appId}`).then(async (res) => {
			const data = await res.json()
			setApp({...data, icon: appId ? `https://getumbrel.github.io/umbrel-apps-gallery/${appId}/icon.svg` : undefined})
		})
	}, [appId])

	return app
}

function useWallpaperId() {
	const [wallpaper, setWallpaper] = useState<WallpaperId>()

	useEffect(() => {
		fetch('/v1/account/wallpaper')
			.then(async (res) => {
				// `unknown` because `any` is too loose
				const id = (await res.text()) as unknown
				const knownId = arrayIncludes(wallpaperIds, id) ? id : '18'
				setWallpaper(knownId)
			})
			.catch(() => {
				setWallpaper('18')
			})
	}, [])

	return wallpaper
}

function LoginWithLayout({children}: {children: ReactNode}) {
	const params = useQueryParams<{app: string; path: string; host: string}>()
	const app = useApp(params.object.app)
	const wallpaperId = useWallpaperId()

	useWallpaperCssVars(wallpaperId)

	return (
		<>
			<FadeInImg
				src={`/wallpapers/generated-thumbs/${wallpaperId}.jpg`}
				className='pointer-events-none fixed inset-0 h-full w-full scale-125 object-cover object-center blur-[var(--wallpaper-blur)] duration-1000'
			/>
			<div className='fixed inset-0 bg-black/50  contrast-more:bg-black' />
			<div className='relative flex min-h-[100dvh] flex-col items-center justify-between p-5'>
				<div className='flex h-full w-full flex-grow items-center justify-center'>
					<div
						className={cn(
							'w-full rounded-20 bg-dialog-content/70 p-8 shadow-dialog sm:max-w-[480px]',
							'flex flex-col gap-5',
							'duration-200 ease-out animate-in fade-in zoom-in-90',
						)}
					>
						<div className='flex h-0 -translate-y-[56px] gap-5'>
							<AppIcon src='/figma-exports/umbrel-ios.png' size={56} className='rounded-12' />
							<AppIcon src={app.icon} size={56} className='rounded-12 bg-neutral-600' />
						</div>
						<div className='flex flex-col gap-1'>
							<h1 className='truncate text-17 font-semibold leading-tight -tracking-2'>
								{t('login-with-umbrel.title')}
							</h1>
							<p className='text-13 leading-tight -tracking-2 text-white/40'>
								{t('login-with-umbrel.description', {app: app.name})}
							</p>
						</div>
						{children}
					</div>
				</div>
			</div>
		</>
	)
}
