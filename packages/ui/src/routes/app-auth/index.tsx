import {AnimatePresence, motion} from 'motion/react'
import {useEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {arrayIncludes} from 'ts-extras'

import {AppIcon} from '@/components/app-icon'
import {FadeInImg} from '@/components/ui/fade-in-img'
import {useQueryParams} from '@/hooks/use-query-params'
import {SubTitle, Title} from '@/layouts/bare/shared'
import {cn} from '@/lib/utils'
import {AccountDock} from '@/modules/auth/account-dock'
import {OWNER_USER_ID} from '@/modules/auth/constants'
import {LoginForm} from '@/modules/auth/login-form'
import {TwoFactorForm} from '@/modules/auth/two-factor-form'
import {useAccountLanguage} from '@/modules/auth/use-account-language'
import {useAccountPicker, type Account} from '@/modules/auth/use-account-picker'
import {
	useWallpaperCssVars,
	WallpaperAvifSource,
	WallpaperId,
	wallpaperIds,
	wallpapersKeyed,
} from '@/providers/wallpaper'
import {firstNameFromFullName} from '@/utils/misc'

type Step = 'account' | 'password' | '2fa'
type LoginAttempt = {userId: string}
type LoginResponse = HandoffResponse | {error?: {code: number; message: string}}
const appAuthFallbackWallpaperId = '23' satisfies WallpaperId

function useAccounts() {
	// isLoaded flips once the request settles (success or failure) — the page
	// holds on the bare wallpaper until then so the single-account form never
	// flashes before the dock
	const [state, setState] = useState<{accounts: Account[]; isLoaded: boolean}>({accounts: [], isLoaded: false})

	useEffect(() => {
		fetch('/v1/account/accounts')
			.then(async (res) => {
				const data = (await res.json()) as unknown
				setState({accounts: Array.isArray(data) ? (data as Account[]) : [], isLoaded: true})
			})
			.catch(() => setState({accounts: [], isLoaded: true}))
	}, [])

	return state
}

// The same lock-screen experience as routes/login.tsx, reframed for the app
// proxy: the app is the hero while picking an account (that step carries no
// password to confuse), then the password step pivots to Umbrel identity —
// avatar, greeting, and an explicit "Umbrel password" label — so nobody types
// the app's own password here.
export default function LoginWithUmbrel() {
	const {t} = useTranslation()
	const [password, setPassword] = useState('')
	const [error, setError] = useState<string>()
	const [isPending, setIsPending] = useState(false)
	const [step, setStep] = useState<Step>('account')

	// Owner centered, members alternating outwards — same dock as the lock screen
	const {accounts: rawAccounts, isLoaded: accountsLoaded} = useAccounts()
	const {
		accounts,
		hasMultipleAccounts,
		selectedIndex,
		hoveredIndex,
		selectedAccount: account,
		activeAccount,
		selectAccount,
		setHoveredIndex,
	} = useAccountPicker(rawAccounts)
	const userId = account?.userId ?? OWNER_USER_ID
	useAccountLanguage(account?.language)
	const selectedUserIdRef = useRef(userId)
	selectedUserIdRef.current = userId
	const activeLoginAttemptRef = useRef<LoginAttempt | undefined>(undefined)

	// Only show the account picker when there's more than one account
	const effectiveStep: Step = step === 'account' && !hasMultipleAccounts ? 'password' : step
	const chosen = effectiveStep === 'password'

	const params = useQueryParams<{app: string; path: string; host: string}>()
	const app = useApp(params.object.app)
	const fallbackWallpaperId = useWallpaperId()
	const activeWallpaperId = activeAccount?.wallpaper?.id
	const wallpaperId =
		activeWallpaperId && arrayIncludes(wallpaperIds, activeWallpaperId) ? activeWallpaperId : fallbackWallpaperId
	useWallpaperCssVars(wallpaperId)
	const wallpaper = wallpapersKeyed[wallpaperId ?? appAuthFallbackWallpaperId]

	const login = useLogin()
	const loginIsPending = isPending || activeLoginAttemptRef.current !== undefined

	const beginLoginAttempt = () => {
		if (activeLoginAttemptRef.current) return
		const attempt = {userId}
		activeLoginAttemptRef.current = attempt
		setIsPending(true)
		return attempt
	}

	const isCurrentLoginAttempt = (attempt: LoginAttempt) =>
		activeLoginAttemptRef.current === attempt && selectedUserIdRef.current === attempt.userId

	const finishLoginAttempt = (attempt: LoginAttempt) => {
		if (activeLoginAttemptRef.current !== attempt) return
		activeLoginAttemptRef.current = undefined
		setIsPending(false)
	}

	const resetEntry = () => {
		setPassword('')
		setError(undefined)
	}

	const handleBrowseAccount = (index: number) => {
		if (activeLoginAttemptRef.current || isPending) return
		selectAccount(index)
		resetEntry()
	}

	const handleSelectAccount = (index: number) => {
		if (activeLoginAttemptRef.current || isPending) return
		selectAccount(index)
		resetEntry()
		setStep('password')
	}

	useEffect(() => {
		fetch('/v1/account/session' + document.location.search)
			.then(async (response) => {
				if (response.ok) submitHandoff(await response.json())
			})
			.catch(() => {})
	}, [])

	const handleSubmitPassword = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()
		const attempt = beginLoginAttempt()
		if (!attempt) return
		setError(undefined)
		try {
			const data = await login({userId: attempt.userId, password, totpToken: ''}, () => isCurrentLoginAttempt(attempt))
			if (!isCurrentLoginAttempt(attempt)) {
				finishLoginAttempt(attempt)
				return
			}
			if ('url' in data) {
				return
			}
			if ('error' in data && data.error) {
				if (data.error.message === 'Missing 2FA code') {
					setStep('2fa')
				} else {
					setError(data.error.message)
					setPassword('')
				}
			}
			finishLoginAttempt(attempt)
			// On success the login helper posts the token form and the page
			// navigates away — stay pending so the button doesn't flash back
		} catch (error: unknown) {
			if (!isCurrentLoginAttempt(attempt)) {
				finishLoginAttempt(attempt)
				return
			}
			const message = error instanceof Error ? error.message : String(error)
			if (message === 'Missing 2FA code') {
				setStep('2fa')
			} else {
				setError(message)
				setPassword('')
			}
			finishLoginAttempt(attempt)
		}
	}

	// Specifying return because we want to ensure that the return type is a boolean for the `onCodeCheck` prop
	const handleSubmit2fa = async (totpToken: string): Promise<boolean> => {
		const attempt = beginLoginAttempt()
		if (!attempt) return false
		setError(undefined)
		try {
			const data = await login({userId: attempt.userId, password, totpToken}, () => isCurrentLoginAttempt(attempt))
			if (!isCurrentLoginAttempt(attempt)) {
				finishLoginAttempt(attempt)
				return false
			}

			// Success responses carry the redirect url; an error means the code failed
			if ('url' in data) {
				return true
			}
			if ('error' in data && data.error) setError(data.error.message)
			finishLoginAttempt(attempt)
			return false
		} catch (error) {
			const isCurrent = isCurrentLoginAttempt(attempt)
			finishLoginAttempt(attempt)
			if (!isCurrent) return false
			setError(error instanceof Error ? error.message : String(error))
			throw error
		}
	}

	// Back from the code step to the password, where another account can be chosen too
	const handleBackFrom2fa = () => {
		if (activeLoginAttemptRef.current || isPending) return
		resetEntry()
		setStep('password')
	}

	const captionAccount = activeAccount

	return (
		<>
			<picture>
				<WallpaperAvifSource wallpaper={wallpaper} tier='thumbnails' />
				<FadeInImg
					src={wallpaper.url}
					className='pointer-events-none fixed inset-0 h-full w-full scale-125 object-cover object-center blur-[var(--wallpaper-blur)] duration-1000'
				/>
			</picture>
			<div className='fixed inset-0 bg-black/50 contrast-more:bg-black' />
			{/* Hold on the bare wallpaper until we know single vs multi account */}
			{!accountsLoaded ? null : (
				// No overflow clip here: any clip boundary slices the plucked lens
				// and the dock's w-screen strip mid-screen. The dock clamps the
				// lens inside the viewport itself, which keeps scrollbars away.
				<div className='relative z-10 flex min-h-[100dvh] w-full animate-in flex-col items-center justify-center duration-300 fade-in'>
					{effectiveStep === '2fa' ? (
						<div className='flex w-full animate-in flex-col items-center gap-5 duration-300 fade-in'>
							<div className='flex flex-col items-center gap-1.5'>
								<Title>{t('login-2fa.title')}</Title>
								<SubTitle>{t('login-2fa.subtitle')}</SubTitle>
							</div>
							<TwoFactorForm
								onCodeCheck={handleSubmit2fa}
								error={error}
								isPending={loginIsPending}
								onBack={handleBackFrom2fa}
							/>
						</div>
					) : (
						<div
							className={cn(
								'flex w-full flex-col items-center justify-center transition-transform duration-500',
								// Short screens scroll instead: lifted, the top would be out of reach
								!chosen && '-translate-y-10 low:translate-y-0',
							)}
						>
							{/* umbrelOS + app icons fanned like a card stack (each rotated
						    about its bottom center, app on top), with the identity-first
						    title; exits like the lock screen's logo once chosen */}
							<AnimatePresence initial={false}>
								{/* With one account there's no picker step, so the header
								    stays put as the page's identity (no avatar to show) */}
								{(!chosen || !hasMultipleAccounts) && (
									<motion.div
										key='app-header'
										// The account dock's lens rises 48px above the dock's own box, so
										// the title gets the lock screen's clearance below its logo (just
										// clear of the lens on short screens)
										className={cn(
											'flex flex-col items-center gap-5 overflow-visible',
											hasMultipleAccounts ? 'mb-24 low:mb-14' : 'mb-10',
										)}
										exit={{opacity: 0, y: -28, height: 0, marginBottom: 0}}
										transition={{duration: 0.2}}
									>
										<div className='relative h-[92px] w-[160px]'>
											<div
												className='absolute top-1 left-1/2'
												style={{
													transform: 'translateX(-50%) translateX(-22px) rotate(-9deg)',
													transformOrigin: 'bottom center',
												}}
											>
												<AppIcon src='/assets/umbrel-ios.png' size={84} className='rounded-24 shadow-xl' />
											</div>
											<div
												className='absolute top-0 left-1/2'
												style={{
													transform: 'translateX(-50%) translateX(22px) rotate(9deg)',
													transformOrigin: 'bottom center',
												}}
											>
												{app.icon && <AppIcon src={app.icon} size={88} className='rounded-24 shadow-xl' />}
											</div>
										</div>
										{/* With one account the greeting follows immediately — the
										    icons alone carry the identity, skip the title */}
										{!chosen && (
											<Title>
												<span style={{fontFamily: "'SF Pro Rounded', 'Inter', system-ui, sans-serif"}}>
													{t('login-with-umbrel.title')}
												</span>
											</Title>
										)}
									</motion.div>
								)}
							</AnimatePresence>

							{hasMultipleAccounts && (
								<>
									<AccountDock
										accounts={accounts}
										selectedIndex={selectedIndex}
										hoveredIndex={hoveredIndex}
										chosen={chosen}
										disabled={loginIsPending}
										onSelect={handleSelectAccount}
										onBrowse={handleBrowseAccount}
										onHover={setHoveredIndex}
									/>
									{/* Desktop hands the name to the greeting once chosen; mobile
									    keeps it here so the greeting stays a fixed, unwrappable
									    line. Hidden at the container so it reserves no space. */}
									<div className={cn('relative mt-3 h-6 w-full text-center', chosen && 'md:hidden')}>
										<AnimatePresence>
											{captionAccount && (
												<motion.span
													key={captionAccount.userId}
													className='absolute inset-x-0 text-17 font-semibold -tracking-2 text-white/90'
													style={{textShadow: '0 1px 3px rgba(0, 0, 0, 0.4)'}}
													initial={{opacity: 0}}
													animate={{opacity: 1}}
													exit={{opacity: 0}}
													transition={{duration: 0.15}}
												>
													{firstNameFromFullName(captionAccount.name)}
												</motion.span>
											)}
										</AnimatePresence>
									</div>
								</>
							)}

							<AnimatePresence initial={false}>
								{chosen && (
									<motion.div
										key='password-form'
										className='w-full overflow-hidden'
										initial={{height: 0, opacity: 0}}
										animate={{height: 'auto', opacity: 1}}
										exit={{height: 0, opacity: 0}}
										transition={{duration: 0.25}}
									>
										<div className='flex flex-col items-center gap-5 pt-2'>
											<LoginForm
												account={account}
												password={password}
												onPasswordChange={setPassword}
												error={error}
												isPending={loginIsPending}
												onSubmit={handleSubmitPassword}
												subtitle={app.name ? t('login-with-umbrel.description', {app: app.name}) : undefined}
												submitLabel={app.name ? t('login-with-umbrel.open-app', {app: app.name}) : undefined}
											/>
										</div>
									</motion.div>
								)}
							</AnimatePresence>
						</div>
					)}
				</div>
			)}
		</>
	)
}

function useLogin() {
	// /v1/account/login

	const login = (
		{userId, password, totpToken}: {userId: string; password: string; totpToken: string},
		shouldSubmit: () => boolean,
	) => {
		// Forward the query params to the login endpoint
		return fetch('/v1/account/login' + document.location.search, {
			method: 'POST',
			headers: {'Content-Type': 'application/json'},
			body: JSON.stringify({userId, password, totpToken}),
		}).then(async (res) => {
			const parsed = (await res.json()) as LoginResponse | string
			// The server responds with a bare string for request validation
			// failures — normalize so `'url' in data` checks can't throw
			const data: LoginResponse =
				typeof parsed === 'object' && parsed !== null ? parsed : {error: {code: 0, message: String(parsed)}}

			// Form submission is the irreversible login side effect, so evaluate the
			// caller's request-identity guard immediately before doing it.
			if ('url' in data && shouldSubmit()) {
				submitHandoff(data)
			}

			return data
		})
	}

	return login
}

type HandoffResponse = {
	url: string
	params: {r: string; handoff: string}
}

function submitHandoff(data: HandoffResponse) {
	const form = document.createElement('form')
	form.method = 'POST'
	// The app's own fragment (e.g. a key it was opened with) came through the
	// proxy's redirect to this page. Carrying it on the action lets the browser
	// keep it through the handoff's redirect too, still never sent to a server.
	form.action = data.url + document.location.hash
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

type App = {
	id: string
	icon: string
	name: string
}

function useApp(appId: string) {
	const [app, setApp] = useState<App>({id: '', icon: '', name: ''})

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
				const appearance = (await res.json()) as {id?: unknown}
				const id = appearance.id
				const knownId = arrayIncludes(wallpaperIds, id) ? id : appAuthFallbackWallpaperId
				setWallpaper(knownId)
			})
			.catch(() => {
				setWallpaper(appAuthFallbackWallpaperId)
			})
	}, [])

	return wallpaper
}
