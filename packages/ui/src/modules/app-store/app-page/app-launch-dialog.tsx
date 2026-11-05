import {useEffect, useId, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {useNavigate} from 'react-router-dom'

import {Button} from '@/components/ui/button'
import {Checkbox} from '@/components/ui/checkbox'
import {CopyableField} from '@/components/ui/copyable-field'
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {useLaunchApp} from '@/hooks/use-launch-app'
import {useQueryParams} from '@/hooks/use-query-params'
import {cn} from '@/lib/utils'
import {useUserApp} from '@/providers/apps'
import {trpcReact} from '@/trpc/trpc'
import {useDialogOpenProps} from '@/utils/dialog'
import {getAlwaysOpenHttpsRequiredApps, setAlwaysOpenHttpsRequiredApps} from '@/utils/misc'
import {tw} from '@/utils/tw'

export function AppLaunchDialog() {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const {params} = useQueryParams()
	const dialogProps = useDialogOpenProps('app-launch')
	const appId = params.get('app-launch-for')
	const path = params.get('app-launch-path') ?? undefined
	const requestedProtocol = params.get('app-launch-protocol')
	const protocol = requestedProtocol === 'http:' || requestedProtocol === 'https:' ? requestedProtocol : undefined
	// Snapshot the sections so saving preferences does not hide them mid-dialog.
	const showCredentials = params.get('app-launch-credentials') === 'true'
	const showHttps = params.get('app-launch-https') === 'true'
	const {app, isLoading} = useUserApp(appId)
	const launchApp = useLaunchApp()
	const httpsCheckboxId = useId()
	const userQ = trpcReact.user.get.useQuery()
	// HTTPS is set up in Advanced settings, which only the owner can open
	const canSetUpHttps = userQ.data?.role === 'owner'
	const [alwaysOpen, setAlwaysOpen] = useState(getAlwaysOpenHttpsRequiredApps)

	const {open} = dialogProps
	useEffect(() => {
		if (open) setAlwaysOpen(getAlwaysOpenHttpsRequiredApps())
	}, [open, appId])

	if (isLoading || !appId || !app) return null

	const openApp = () => {
		// Dismissing the dialog must not persist an abandoned HTTPS preference.
		if (showHttps) setAlwaysOpenHttpsRequiredApps(alwaysOpen)
		// Both prompts have been handled here, so this opens the app without another dialog.
		launchApp(appId, {direct: true, protocol: showHttps ? 'https:' : protocol, path})
		dialogProps.onOpenChange(false)
	}

	const httpsDescription = t('app-requires-https-dialog-description', {app: app.name})

	return (
		<Dialog {...dialogProps}>
			<DialogContent
				className='max-h-[calc(100dvh_-_2rem)] max-w-[calc(100vw_-_2rem)] p-0'
				onOpenAutoFocus={(event) => {
					// Keep credential fields from taking focus automatically.
					if (showCredentials) event.preventDefault()
				}}
			>
				<div className='umbrel-dialog-fade-scroller flex flex-col overflow-y-auto p-6 sm:p-7'>
					<DialogHeader>
						<DialogTitle className='text-19'>{t('default-credentials.open', {app: app.name})}</DialogTitle>
						<DialogDescription className='text-13 leading-relaxed text-white/60'>
							{showCredentials ? t('default-credentials.description') : httpsDescription}
						</DialogDescription>
					</DialogHeader>
					{showCredentials && (
						<div className='mt-5'>
							<div className='divide-y divide-white/8 overflow-hidden rounded-12 border border-white/10 bg-white/4'>
								{app.credentials.defaultUsername && (
									<CredentialRow label={t('default-credentials.username')} value={app.credentials.defaultUsername} />
								)}
								{app.credentials.defaultPassword && (
									<CredentialRow
										label={t('default-credentials.password')}
										value={app.credentials.defaultPassword}
										isPassword
									/>
								)}
							</div>
							<div className='mt-2'>
								<ShowCredentialsBeforeOpenCheckbox appId={appId} />
							</div>
						</div>
					)}
					{showHttps && (
						<div className={cn('mt-5', showCredentials && 'border-t border-white/8 pt-4')}>
							{(showCredentials || canSetUpHttps) && (
								<p className='text-12 leading-relaxed text-white/60'>
									{showCredentials && <>{httpsDescription} </>}
									{canSetUpHttps && (
										<button
											type='button'
											onClick={() => navigate('/settings/advanced/network?httpsAccess=guide')}
											className='text-white/70 underline decoration-white/30 underline-offset-2 transition-colors hover:text-white'
										>
											{t('app-requires-https-dialog-learn')}
										</button>
									)}
								</p>
							)}
							<label htmlFor={httpsCheckboxId} className={cn(preferenceRowClass, 'mt-1')}>
								<Checkbox
									id={httpsCheckboxId}
									className={preferenceCheckboxClass}
									checked={alwaysOpen}
									onCheckedChange={(checked) => setAlwaysOpen(checked === true)}
								/>
								<span>{t('app-requires-https-dialog-always-open')}</span>
							</label>
						</div>
					)}
					<Button variant='primary' size='dialog' className='mt-5 md:self-end' onClick={openApp}>
						{showHttps || protocol === 'https:'
							? t('app-requires-https-dialog-action')
							: t('default-credentials.open', {app: app.name})}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	)
}

function ShowCredentialsBeforeOpenCheckbox({appId}: {appId: string}) {
	const {t} = useTranslation()
	const checkboxId = useId()
	const {app, isLoading} = useUserApp(appId)

	const showCredentials = app?.credentials?.showBeforeOpen ?? false

	const utils = trpcReact.useUtils()

	const hideCredentialsBeforeOpenMut = trpcReact.apps.hideCredentialsBeforeOpen.useMutation({
		onSuccess: () => utils.apps.invalidate(),
	})

	return (
		<div>
			<label htmlFor={checkboxId} className={preferenceRowClass}>
				<Checkbox
					id={checkboxId}
					className={preferenceCheckboxClass}
					checked={!showCredentials}
					disabled={isLoading || hideCredentialsBeforeOpenMut.isPending}
					onCheckedChange={(checked) => hideCredentialsBeforeOpenMut.mutate({appId, value: checked === true})}
				/>
				<span>{t('default-credentials.dont-show-again')}</span>
			</label>
			{!showCredentials && (
				<p className='pt-1 pl-6 text-12 leading-relaxed text-white/50'>
					{t('default-credentials.dont-show-again-notice')}
				</p>
			)}
		</div>
	)
}

function CredentialRow({label, value, isPassword}: {label: string; value: string; isPassword?: boolean}) {
	return (
		<div
			className='grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-center gap-2 px-3 py-2.5'
			role='group'
			aria-label={label}
		>
			<span className='text-12 leading-snug text-white/50'>{label}</span>
			<CopyableField
				value={value}
				isPassword={isPassword}
				className='rounded-none border-0 bg-transparent text-white/90 [&>input]:pl-0'
			/>
		</div>
	)
}

const preferenceRowClass = tw`flex min-h-7 cursor-pointer items-center gap-2 text-12 leading-snug font-normal text-white/50 transition-colors hover:text-white/70`
const preferenceCheckboxClass = tw`size-3.5 rounded-3 border-white/25 bg-transparent [&_svg]:size-3`
