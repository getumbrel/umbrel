import {formatDistanceToNowStrict} from 'date-fns'
import {useTranslation} from 'react-i18next'
import {TbDeviceDesktop, TbDeviceMobile, TbHelp} from 'react-icons/tb'
import {useNavigate} from 'react-router-dom'

import {Button} from '@/components/ui/button'
import {Dialog, DialogHeader, DialogScrollableContent, DialogTitle} from '@/components/ui/dialog'
import {Drawer, DrawerContent, DrawerHeader, DrawerScroller, DrawerTitle} from '@/components/ui/drawer'
import {Loading} from '@/components/ui/loading'
import {toast} from '@/components/ui/toast'
import {useIsPhone} from '@/hooks/use-is-mobile'
import {finishBrowserLogout} from '@/modules/auth/logout'
import {parseNativeSessionClient, parseSessionUserAgent, SessionClient} from '@/modules/auth/session-user-agent'
import {useConfirmation} from '@/providers/confirmation'
import {BackButton, useSettingsDialogProps} from '@/routes/settings/_components/shared'
import {RouterOutput, trpcReact} from '@/trpc/trpc'
import {languageCodeToDateLocale} from '@/utils/date-time'

type Session = RouterOutput['user']['listSessions'][number]

type SessionsViewProps = {
	onBack?: () => void
	backLabel?: string
	sessions?: Session[]
	isLoading: boolean
	isError: boolean
	isMutating: boolean
	refreshSessions: () => Promise<unknown>
	revokeSession: (sessionId: string) => Promise<{revoked: boolean; revokedCurrent: boolean}>
	revokeOtherSessions?: () => Promise<{revokedCount: number}>
	revokeAllSessions?: () => Promise<{revokedCount: number; revokedCurrent: boolean}>
	managedAccountName?: string
}

export function SessionsPanel({onBack, backLabel}: {onBack?: () => void; backLabel?: string}) {
	const utils = trpcReact.useUtils()
	const sessionsQ = trpcReact.user.listSessions.useQuery()
	const revokeSessionMut = trpcReact.user.revokeSession.useMutation()
	const revokeOtherSessionsMut = trpcReact.user.revokeOtherSessions.useMutation()

	return (
		<SessionsView
			onBack={onBack}
			backLabel={backLabel}
			sessions={sessionsQ.data}
			isLoading={sessionsQ.isLoading}
			isError={sessionsQ.isError}
			isMutating={revokeSessionMut.isPending || revokeOtherSessionsMut.isPending}
			refreshSessions={() => utils.user.listSessions.invalidate()}
			revokeSession={(sessionId) => revokeSessionMut.mutateAsync({sessionId})}
			revokeOtherSessions={() => revokeOtherSessionsMut.mutateAsync()}
		/>
	)
}

export function ManagedSessionsPanel({
	userId,
	accountName,
	onBack,
}: {
	userId: string
	accountName: string
	onBack: () => void
}) {
	const utils = trpcReact.useUtils()
	const sessionsQ = trpcReact.user.listAccountSessions.useQuery({userId})
	const revokeSessionMut = trpcReact.user.revokeAccountSession.useMutation()
	const revokeAllSessionsMut = trpcReact.user.revokeAllAccountSessions.useMutation()

	return (
		<SessionsView
			onBack={onBack}
			backLabel={accountName}
			sessions={sessionsQ.data}
			isLoading={sessionsQ.isLoading}
			isError={sessionsQ.isError}
			isMutating={revokeSessionMut.isPending || revokeAllSessionsMut.isPending}
			refreshSessions={() => utils.user.listAccountSessions.invalidate({userId})}
			revokeSession={(sessionId) => revokeSessionMut.mutateAsync({userId, sessionId})}
			revokeAllSessions={() => revokeAllSessionsMut.mutateAsync({userId})}
			managedAccountName={accountName}
		/>
	)
}

function SessionsView({
	onBack,
	backLabel,
	sessions,
	isLoading,
	isError,
	isMutating,
	refreshSessions,
	revokeSession: revokeSessionMutation,
	revokeOtherSessions: revokeOtherSessionsMutation,
	revokeAllSessions: revokeAllSessionsMutation,
	managedAccountName,
}: SessionsViewProps) {
	const {t, i18n} = useTranslation()
	const confirm = useConfirmation()

	const confirmAction = async (title: string, message: string, action: string) => {
		try {
			const result = await confirm({
				title,
				message,
				actions: [
					{label: action, value: 'confirm', variant: 'destructive'},
					{label: t('cancel'), value: 'cancel', variant: 'default'},
				],
			})
			return result.actionValue === 'confirm'
		} catch {
			return false
		}
	}

	const revokeSession = async (session: Session) => {
		const confirmed = await confirmAction(
			session.current ? t('sessions.revoke-current-confirm-title') : t('active-logins.logout-device-title'),
			session.current ? t('sessions.revoke-current-confirm-description') : t('active-logins.logout-device-description'),
			t('active-logins.logout'),
		)
		if (!confirmed) return

		try {
			const result = await revokeSessionMutation(session.id)
			if (result.revokedCurrent) return finishBrowserLogout()
			if (!result.revoked) throw new Error('Session no longer exists')
			await refreshSessions()
		} catch {
			toast.error(t('active-logins.logout-error'), {area: 'settings'})
			await refreshSessions()
		}
	}

	const revokeOtherSessions = async () => {
		if (!revokeOtherSessionsMutation) return
		const confirmed = await confirmAction(
			t('active-logins.logout-other-devices-title'),
			t('active-logins.logout-other-devices-description'),
			t('active-logins.logout-other-devices'),
		)
		if (!confirmed) return

		try {
			await revokeOtherSessionsMutation()
			await refreshSessions()
		} catch {
			toast.error(t('active-logins.logout-error'), {area: 'settings'})
		}
	}

	// Only reachable from the managed panel (owner acting on a member's sessions);
	// a user's own panel offers per-session revocation and "log out other devices".
	const revokeAllSessions = async () => {
		if (!revokeAllSessionsMutation) return
		const confirmed = await confirmAction(
			t('active-logins.logout-everywhere-title'),
			t('active-logins.managed-logout-everywhere-description', {name: managedAccountName}),
			t('active-logins.logout-everywhere'),
		)
		if (!confirmed) return

		try {
			const result = await revokeAllSessionsMutation()
			if (result.revokedCurrent) return finishBrowserLogout()
			await refreshSessions()
		} catch {
			toast.error(t('active-logins.logout-error'), {area: 'settings'})
		}
	}

	return (
		<div className='flex flex-col gap-4'>
			{onBack && backLabel && <BackButton onClick={onBack}>{backLabel}</BackButton>}
			<div className='space-y-1'>
				<h2 className='text-17 font-semibold -tracking-2'>{t('active-logins.title')}</h2>
				<p className='text-13 leading-tight text-white/45'>
					{managedAccountName
						? t('active-logins.managed-description', {name: managedAccountName})
						: t('active-logins.description')}
				</p>
			</div>

			{isLoading ? (
				<div className='flex min-h-32 items-center justify-center'>
					<Loading>{t('loading')}</Loading>
				</div>
			) : isError ? (
				<div className='rounded-12 bg-white/6 p-4 text-13 text-white/50'>{t('active-logins.load-error')}</div>
			) : sessions?.length === 0 ? (
				<div className='rounded-12 bg-white/6 p-4 text-13 text-white/50'>{t('active-logins.empty')}</div>
			) : (
				<div className='flex flex-col gap-2'>
					{sessions?.map((session) => {
						const client =
							session.client.type === 'native'
								? parseNativeSessionClient(session.client)
								: parseSessionUserAgent(session.client.userAgent)
						const description = client.label ?? t('active-logins.unknown-device')
						const language = i18n.resolvedLanguage ?? i18n.language
						const details =
							session.client.type === 'native'
								? `${session.client.appVersion} (${session.client.appBuild}) · ${session.client.osVersion}`
								: session.client.userAgent

						return (
							<div key={session.id} className='flex items-center gap-3 rounded-12 bg-white/6 p-3.5'>
								<SessionClientIcon client={client} />
								<div className='min-w-0 flex-1 space-y-1' title={details}>
									<div className='flex flex-wrap items-center gap-1.5'>
										<h3 className='text-13 leading-tight font-medium'>{description}</h3>
										{session.current && (
											<span className='rounded-full bg-brand/20 px-1.5 py-[3px] text-11 leading-none font-medium whitespace-nowrap text-brand-lightest'>
												{t('active-logins.current')}
											</span>
										)}
									</div>
									<div className='space-y-[2px]'>
										<p className='text-11 leading-tight text-white/35' title={formatDate(session.lastSeenAt, language)}>
											{t('active-logins.last-active-ago', {ago: relativeDate(session.lastSeenAt, language)})}
										</p>
										<p className='text-11 leading-tight text-white/35'>
											{t('active-logins.logged-in', {date: formatDate(session.createdAt, language)})}
										</p>
									</div>
								</div>
								<Button size='sm' disabled={isMutating} onClick={() => revokeSession(session)}>
									{t('active-logins.logout')}
								</Button>
							</div>
						)
					})}
				</div>
			)}

			<div className='mt-1 flex justify-end'>
				{revokeOtherSessionsMutation ? (
					<Button
						text='destructive'
						disabled={isMutating || !sessions || sessions.length <= 1}
						onClick={revokeOtherSessions}
					>
						{t('active-logins.logout-everywhere-except')}
					</Button>
				) : revokeAllSessionsMutation ? (
					<Button text='destructive' disabled={isMutating || !sessions?.length} onClick={revokeAllSessions}>
						{t('active-logins.logout-everywhere')}
					</Button>
				) : null}
			</div>
		</div>
	)
}

export default function SessionsDrawerOrDialog() {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const isPhone = useIsPhone()
	const dialogProps = useSettingsDialogProps()
	const onBack = () => navigate('/settings')
	const panel = <SessionsPanel onBack={onBack} backLabel={t('settings')} />

	if (isPhone) {
		return (
			<Drawer {...dialogProps}>
				<DrawerContent fullHeight>
					<DrawerHeader className='sr-only'>
						<DrawerTitle>{t('active-logins.title')}</DrawerTitle>
					</DrawerHeader>
					<DrawerScroller>
						<div className='px-5 py-6'>{panel}</div>
					</DrawerScroller>
				</DrawerContent>
			</Drawer>
		)
	}

	return (
		<Dialog {...dialogProps}>
			<DialogScrollableContent>
				<DialogHeader className='sr-only'>
					<DialogTitle>{t('active-logins.title')}</DialogTitle>
				</DialogHeader>
				<div className='px-5 py-6'>{panel}</div>
			</DialogScrollableContent>
		</Dialog>
	)
}

// Client icon with the OS logo overlaid as a small bottom-right badge. Unknown
// clients keep the generic device glyph.
function SessionClientIcon({client}: {client: SessionClient}) {
	const DeviceIcon =
		client.deviceType === 'mobile' ? TbDeviceMobile : client.deviceType === 'desktop' ? TbDeviceDesktop : TbHelp
	const icon = client.clientIcon ?? client.browserIcon

	return (
		<div className='relative size-10 shrink-0'>
			{icon ? (
				<img src={icon} alt={client.label} draggable={false} className='size-10 object-contain' />
			) : (
				<div className='grid size-10 place-items-center rounded-8 bg-white/6'>
					<DeviceIcon className='size-5 text-white/60' />
				</div>
			)}
			{client.osIcon && (
				<img
					src={client.osIcon}
					alt={client.os}
					draggable={false}
					className='absolute -right-1.5 -bottom-1.5 size-5 rounded-6 border border-white/10 bg-neutral-800 object-contain p-[3px]'
				/>
			)}
		</div>
	)
}

function formatDate(timestamp: number, locale: string) {
	try {
		return new Intl.DateTimeFormat(locale, {dateStyle: 'medium', timeStyle: 'short'}).format(timestamp)
	} catch {
		return new Date(timestamp).toLocaleString()
	}
}

// "3 hours ago" / "2 days ago", localized the same way as the Files cloud banner
function relativeDate(timestamp: number, language: string) {
	return formatDistanceToNowStrict(new Date(timestamp), {
		addSuffix: true,
		locale: languageCodeToDateLocale[language as keyof typeof languageCodeToDateLocale],
	})
}
