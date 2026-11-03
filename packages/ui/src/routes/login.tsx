import {AnimatePresence, motion} from 'motion/react'
import {useEffect, useMemo, useRef, useState} from 'react'
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
import UmbrelLogo from '@/components/umbrel-logo'
import {Layout} from '@/layouts/bare/shared'
import {cn} from '@/lib/utils'
import {AccountDock} from '@/modules/auth/account-dock'
import {OWNER_USER_ID} from '@/modules/auth/constants'
import {LoginForm} from '@/modules/auth/login-form'
import {TwoFactorForm} from '@/modules/auth/two-factor-form'
import {useAccountLanguage} from '@/modules/auth/use-account-language'
import {useAccountPicker, type Account} from '@/modules/auth/use-account-picker'
import {useAuth} from '@/modules/auth/use-auth'
import {Wallpaper, WallpaperAvifSource, wallpapersKeyed, type WallpaperId} from '@/providers/wallpaper'
import {trpcReact} from '@/trpc/trpc'
import {firstNameFromFullName} from '@/utils/misc'

type Step = 'account' | 'password' | '2fa'

export default function Login() {
	const {t} = useTranslation()
	const [password, setPassword] = useState('')

	// List of accounts to choose from. Falls back to a single owner account so
	// the picker is skipped on single-user devices (identical to the old flow).
	const accountsQ = trpcReact.user.listAccounts.useQuery(undefined, {retry: false})
	const rawAccounts: Account[] = useMemo(() => accountsQ.data ?? [], [accountsQ.data])
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

	// Start on the account picker only when there's more than one account
	const [step, setStep] = useState<Step>('account')
	const effectiveStep: Step = step === 'account' && !hasMultipleAccounts ? 'password' : step

	// Show a confirmation dialog when arriving from the static IP confirmation flow
	const location = useLocation()
	const confirmedIp = (location.state as {confirmedIp?: string} | null)?.confirmedIp
	const [showConfirmDialog, setShowConfirmDialog] = useState(!!confirmedIp)

	const {loginWithToken} = useAuth()

	// The account being authenticated. On a single-user device this is the owner.
	const userId = account?.userId ?? OWNER_USER_ID
	useAccountLanguage(account?.language)
	const selectedUserIdRef = useRef(userId)
	selectedUserIdRef.current = userId
	// This ref closes the small gap between mutate() and the React Query render
	// that exposes isPending, so no second interaction can start in that window.
	const activeLoginUserIdRef = useRef<string | undefined>(undefined)

	// Each account can carry its own wallpaper. Hover previews stay active on
	// both the picker and password form, and remain pinned while the lens is free.
	const selectedWallpaper = activeAccount?.wallpaper
		? wallpapersKeyed[activeAccount.wallpaper.id as WallpaperId]
		: undefined
	const [settledWallpaper, setSettledWallpaper] = useState(selectedWallpaper)
	useEffect(() => {
		// Hover previews swap instantly; only selection scrubbing (wheel/drag,
		// which clears hover) is debounced so it can't stack full-screen fades
		const timer = setTimeout(() => setSettledWallpaper(selectedWallpaper), hoveredIndex !== null ? 0 : 250)
		return () => clearTimeout(timer)
	}, [selectedWallpaper])

	const loginMut = trpcReact.user.login.useMutation({
		onSuccess: (token, variables) => {
			if (activeLoginUserIdRef.current !== variables.userId || selectedUserIdRef.current !== variables.userId) {
				return
			}
			loginWithToken(token)
		},
		onError: (error, variables) => {
			if (activeLoginUserIdRef.current !== variables.userId || selectedUserIdRef.current !== variables.userId) {
				return
			}
			if (error.message === 'Missing 2FA code') {
				setStep('2fa')
			} else if (step !== '2fa') {
				// Never clear the password on the 2fa step: it accompanies every
				// code attempt, so clearing it would fail all retries as
				// 'Incorrect password' before the code is even checked
				setPassword('')
			}
		},
		onSettled: (_data, _error, variables) => {
			if (activeLoginUserIdRef.current === variables.userId) activeLoginUserIdRef.current = undefined
		},
	})
	const loginIsPending = loginMut.isPending || activeLoginUserIdRef.current !== undefined
	const loginError = loginMut.variables?.userId === userId ? loginMut.error?.message : undefined
	// The server asks for the code with this error, so on the code step it is no failure
	const twoFactorError = loginError === 'Missing 2FA code' ? undefined : loginError

	// Avatar buttons own dock navigation. Enter with nothing focused commits
	// the current account, while native button Enter commits a focused avatar.
	useEffect(() => {
		if (!hasMultipleAccounts || step !== 'account' || loginIsPending) return
		const onKeyDown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null
			if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return
			if (event.key === 'Enter') {
				// A focused button keeps its native Enter click (avatar buttons,
				// dialog actions) — this shortcut is for Enter with nothing focused
				if (target?.tagName === 'BUTTON') return
				event.preventDefault()
				setStep('password')
			}
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [hasMultipleAccounts, loginIsPending, step])

	// Scroll-browsing re-targets the selection without advancing the step;
	// hover clears so the lens re-centers instead of chasing a stale avatar
	const handleBrowseAccount = (index: number) => {
		if (activeLoginUserIdRef.current !== undefined || loginMut.isPending) return
		selectAccount(index)
		setPassword('')
		loginMut.reset()
	}

	const handleSelectAccount = (index: number) => {
		if (activeLoginUserIdRef.current !== undefined || loginMut.isPending) return
		selectAccount(index)
		setPassword('')
		loginMut.reset()
		setStep('password')
	}

	const handleSubmitPassword = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()
		if (activeLoginUserIdRef.current !== undefined || loginMut.isPending) return
		activeLoginUserIdRef.current = userId
		loginMut.mutate({userId, password})
	}

	// Back from the code step to the password, where another account can be chosen too
	const handleBackFrom2fa = () => {
		if (activeLoginUserIdRef.current !== undefined || loginMut.isPending) return
		setPassword('')
		loginMut.reset()
		setStep('password')
	}

	const handleSubmit2fa = async (totpToken: string) => {
		if (activeLoginUserIdRef.current !== undefined || loginMut.isPending) return false
		activeLoginUserIdRef.current = userId
		const res = await loginMut.mutateAsync({userId, password, totpToken})
		return selectedUserIdRef.current === userId && !!res
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

	if (effectiveStep === '2fa') {
		return (
			<>
				<Layout title={t('login-2fa.title')} subTitle={t('login-2fa.subtitle')}>
					<form className='flex w-full flex-col items-center gap-5 px-4 md:px-0' onSubmit={handleSubmitPassword}>
						<TwoFactorForm
							onCodeCheck={handleSubmit2fa}
							error={twoFactorError}
							isPending={loginIsPending}
							onBack={handleBackFrom2fa}
						/>
					</form>
				</Layout>
				{confirmDialog}
			</>
		)
	}

	// Until the accounts request settles (success or failure), hold on the
	// blurred backdrop — never flash the single-account form before the dock.
	// On failure isFetched is still true and the single-user owner fallback
	// renders as before.
	if (!accountsQ.isFetched) {
		return (
			<>
				<Wallpaper stayBlurred />
				<div className='fixed inset-0 bg-black/10' />
			</>
		)
	}

	// Single-user devices keep the classic lock screen without the dock
	if (!hasMultipleAccounts) {
		return (
			<>
				<Wallpaper stayBlurred />
				<div className='fixed inset-0 bg-black/20' />
				<div className='relative z-10 flex w-full flex-1 animate-in flex-col items-center justify-center gap-5 duration-300 fade-in low:gap-3'>
					{/* A lone account's avatar says nothing the greeting doesn't —
					    show the Umbrel logo instead, like the multi-user picker.
					    A phone on its side has room for the form only with a smaller one */}
					<UmbrelLogo className='mb-4 w-32 shrink-0 low:mb-0 low:w-20' />
					<LoginForm
						account={account}
						password={password}
						onPasswordChange={setPassword}
						error={loginError}
						isPending={loginIsPending}
						onSubmit={handleSubmitPassword}
					/>
				</div>
				{confirmDialog}
			</>
		)
	}

	// Multi-user lock screen: the dock is always present; choosing an account
	// reveals the password form below it and eases the wallpaper blur — the
	// full unblur only happens after a successful login
	const chosen = step === 'password'
	const captionAccount = activeAccount

	return (
		<>
			<Wallpaper stayBlurred className='transition-[filter] duration-700' />
			<AnimatePresence>
				{settledWallpaper && (
					<motion.picture
						key={settledWallpaper.id}
						initial={{opacity: 0}}
						animate={{opacity: 1}}
						exit={{opacity: 0}}
						transition={{duration: 0.7}}
						className='pointer-events-none fixed inset-0 h-lvh w-full'
					>
						<WallpaperAvifSource wallpaper={settledWallpaper} tier='thumbnails' />
						<img
							src={settledWallpaper.url}
							alt=''
							aria-hidden='true'
							className={cn(
								'size-full scale-125 object-cover object-center transition-[filter] duration-700',
								chosen ? 'blur-[7px]' : 'blur-[18px]',
							)}
						/>
					</motion.picture>
				)}
			</AnimatePresence>
			<div className='fixed inset-0 bg-black/10' />
			<div
				className={cn(
					// No overflow clip here: any clip boundary slices the plucked
					// lens mid-screen. The dock clamps the lens inside the viewport
					// itself, which is what keeps scrollbars away.
					'relative z-10 flex w-full flex-1 flex-col items-center justify-center transition-transform duration-500',
					!chosen && '-translate-y-10 low:translate-y-0',
				)}
			>
				<AnimatePresence initial={false}>
					{!chosen && (
						<motion.div
							key='logo'
							className='mb-24 overflow-visible low:mb-6'
							exit={{opacity: 0, y: -28, height: 0, marginBottom: 0}}
							transition={{duration: 0.2}}
						>
							<UmbrelLogo className='w-32 shrink-0 low:w-20' />
						</motion.div>
					)}
				</AnimatePresence>
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
				{/* Desktop hands the name to the greeting once chosen; mobile keeps
				    it here so the greeting stays a fixed, unwrappable line. Hidden
				    at the container so it reserves no space. */}
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

				<AnimatePresence initial={false}>
					{chosen && account && (
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
									error={loginError}
									isPending={loginIsPending}
									onSubmit={handleSubmitPassword}
								/>
							</div>
						</motion.div>
					)}
				</AnimatePresence>
			</div>
			{confirmDialog}
		</>
	)
}
