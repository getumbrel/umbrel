import {ArrowUpRight, Info, Loader2} from 'lucide-react'
import {motion} from 'motion/react'
import {useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {Button} from '@/components/ui/button'
import {DialogFooter} from '@/components/ui/dialog'
import {Input, PasswordInput} from '@/components/ui/input'
import {PinInput} from '@/components/ui/pin-input'
import {toast} from '@/components/ui/toast'
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip'
import {CloudLinkDiagram} from '@/features/files/components/shared/cloud-constellation'
import {CLOUD_PROVIDER_LOGOS} from '@/features/files/constants'
import {
	useCloudConnect,
	useCloudOAuth,
	type CloudAccount,
	type CloudLocations,
	type CloudOAuthFailure,
	type CloudOAuthProvider,
	type CloudProvider,
} from '@/features/files/hooks/use-cloud'
import {buildWebDavFlavorUrl, CLOUD_WEBDAV_FLAVORS, type CloudWebDavFlavorId} from '@/features/files/utils/cloud'
import {getFilesErrorMessage} from '@/features/files/utils/error-messages'
import {cn} from '@/lib/utils'
import type {RouterError} from '@/trpc/trpc'

import {OAuthCodeEntry} from './oauth-code-entry'

export type ConnectedResult = {
	accountId: string
	account: CloudAccount
	locations: CloudLocations
}

type WebDavConnection = Extract<CloudAccount['connection'], {kind: 'webdav'}>

// The link diagram plus the plain-words trust line for the connect moment
function CloudConnectDiagram({
	layoutKey,
	name,
	logo,
	morph,
}: {
	layoutKey: string
	name: string
	logo: string
	morph: boolean
}) {
	const {t} = useTranslation()
	return (
		<div className='flex flex-col items-center gap-4 pt-2 pb-5'>
			<CloudLinkDiagram layoutKey={layoutKey} logo={logo} morph={morph} />
			<motion.p
				initial={{opacity: 0, y: 4}}
				animate={{opacity: 1, y: 0}}
				transition={{duration: 0.25, delay: 0.2}}
				className='max-w-[340px] text-center text-12 leading-relaxed text-white/60'
			>
				{t('files-cloud.connect-direct-note', {provider: name})}
			</motion.p>
		</div>
	)
}

export function ConnectStep({
	provider,
	flavor,
	reauthAccountId,
	savedWebDavConnection,
	morph = true,
	onConnected,
	onBack,
}: {
	provider: CloudProvider
	flavor?: CloudWebDavFlavorId
	reauthAccountId?: string
	savedWebDavConnection?: WebDavConnection
	// Whether the diagram plate continues the shared-element flight from the
	// picker tile; reauth entries that never passed the tile turn this off
	morph?: boolean
	onConnected: (result: ConnectedResult) => void
	onBack: () => void
}) {
	// Reauthentication of an existing account always uses the plain WebDAV form
	// (its URL is shown as-is), but a flavored account keeps its branding and
	// its stored flavor either way
	const useFlavor = Boolean(flavor && !reauthAccountId)
	const heroKey = flavor ?? provider.id
	const heroName = flavor
		? (CLOUD_WEBDAV_FLAVORS.find(({id}) => id === flavor)?.displayName ?? provider.displayName)
		: provider.displayName

	const variant = (() => {
		if (provider.connectionKind === 'oauth') {
			return (
				<OAuthConnect provider={provider} reauthAccountId={reauthAccountId} onConnected={onConnected} onBack={onBack} />
			)
		}
		if (provider.connectionKind === 'webdav') {
			if (useFlavor && flavor) return <WebDavFlavorConnect flavor={flavor} onConnected={onConnected} onBack={onBack} />
			return (
				<WebDavConnect
					flavor={flavor}
					reauthAccountId={reauthAccountId}
					savedConnection={savedWebDavConnection}
					onConnected={onConnected}
					onBack={onBack}
				/>
			)
		}
		return <ICloudConnect reauthAccountId={reauthAccountId} onConnected={onConnected} onBack={onBack} />
	})()

	return (
		<div className='pt-2'>
			<CloudConnectDiagram layoutKey={heroKey} name={heroName} logo={CLOUD_PROVIDER_LOGOS[heroKey]} morph={morph} />
			{variant}
		</div>
	)
}

function OAuthConnect({
	provider,
	reauthAccountId,
	onConnected,
	onBack,
}: {
	provider: CloudProvider
	reauthAccountId?: string
	onConnected: (result: ConnectedResult) => void
	onBack: () => void
}) {
	const {t} = useTranslation()
	const [code, setCode] = useState('')
	const [failure, setFailure] = useState<{kind: CloudOAuthFailure; message?: string} | null>(null)
	const oauth = useCloudOAuth({
		onComplete: onConnected,
		onFailure: (kind, message) => {
			setFailure({kind, message})
			setCode('')
		},
	})
	if (failure) {
		// A recognized backend code explains itself (wrong account on
		// reauthentication, already-connected account); anything else falls back
		// to the generic couldn't-complete line
		const failureText =
			failure.kind === 'expired'
				? t('files-cloud.oauth-expired')
				: failure.message?.includes('[cloud-')
					? getFilesErrorMessage(failure.message)
					: t('files-cloud.oauth-failed', {provider: provider.displayName})
		return (
			<div className='py-2'>
				<div className='flex flex-col items-center gap-4 py-4 text-center'>
					<p className='max-w-[340px] text-13 leading-relaxed text-white/60'>{failureText}</p>
				</div>
				<DialogFooter className='flex-col-reverse justify-center gap-2 pt-4'>
					<Button size='dialog' onClick={onBack}>
						{t('back')}
					</Button>
					<Button variant='primary' size='dialog' onClick={() => setFailure(null)}>
						{t('try-again')}
					</Button>
				</DialogFooter>
			</div>
		)
	}

	if (oauth.isWaiting) {
		return (
			<div className='py-2'>
				{oauth.isPopupBlocked && oauth.authorizationUrl && (
					<div className='mb-4 flex flex-col items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-4 text-center'>
						<p className='max-w-[340px] text-13 leading-relaxed text-white/60'>
							{t('files-cloud.oauth-popup-blocked')}
						</p>
						<Button asChild size='dialog'>
							<a href={oauth.authorizationUrl} target='_blank' rel='noopener noreferrer'>
								{t('files-cloud.oauth-continue', {provider: provider.displayName})}
								<ArrowUpRight className='ml-1 size-4' />
							</a>
						</Button>
					</div>
				)}
				<OAuthCodeEntry
					providerName={provider.displayName}
					code={code}
					disabled={oauth.isCompleting}
					onCodeChange={setCode}
					onSubmit={(value) => oauth.complete(value)}
				/>
				<DialogFooter className='flex-col-reverse justify-center gap-2 pt-4'>
					<Button size='dialog' disabled={oauth.isCompleting} onClick={oauth.cancel}>
						{t('cancel')}
					</Button>
					<Button
						variant='primary'
						size='dialog'
						disabled={!code.trim() || oauth.isCompleting}
						onClick={() => oauth.complete(code)}
					>
						{/* The label stays in the layout under the spinner so the button keeps its width */}
						<span className='relative inline-flex items-center justify-center'>
							<span className={oauth.isCompleting ? 'opacity-0' : undefined}>{t('files-cloud.oauth-finish')}</span>
							{oauth.isCompleting && <Loader2 className='absolute size-4 animate-spin' />}
						</span>
					</Button>
				</DialogFooter>
			</div>
		)
	}

	return (
		<div className='py-2'>
			<div className='flex flex-col items-center gap-4 py-4 text-center'>
				<p className='max-w-[340px] text-13 leading-relaxed text-white/80'>
					{t('files-cloud.oauth-description', {provider: provider.displayName})}
				</p>
			</div>
			<DialogFooter className='flex-col-reverse justify-center gap-2 pt-4'>
				<Button size='dialog' onClick={onBack}>
					{t('back')}
				</Button>
				<Button
					variant='primary'
					size='dialog'
					disabled={oauth.isStarting}
					onClick={() =>
						oauth.begin({provider: provider.id as CloudOAuthProvider, ...(reauthAccountId && {reauthAccountId})})
					}
				>
					{t('files-cloud.oauth-continue', {provider: provider.displayName})}
					<ArrowUpRight className='ml-1 size-4' />
				</Button>
			</DialogFooter>
		</div>
	)
}

function FieldRow({label, info, children}: {label: string; info?: string; children: React.ReactNode}) {
	return (
		<div className='space-y-1.5'>
			<p className='flex items-center gap-1.5 text-13 text-white/60'>
				{label}
				{info && (
					<Tooltip>
						<TooltipTrigger asChild>
							<Info className='size-3.5 cursor-default text-white/30 transition-colors hover:text-white/60' />
						</TooltipTrigger>
						<TooltipContent side='top' className='max-w-[300px]'>
							{info}
						</TooltipContent>
					</Tooltip>
				)}
			</p>
			{children}
		</div>
	)
}

const UNTRUSTED_CERTIFICATE_CODE = '[cloud-webdav-untrusted-certificate]'

const hostOf = (url: string) => {
	try {
		return new URL(url).host
	} catch {
		return url
	}
}

// Asks for explicit consent when the server's certificate can't be verified;
// confirming retries the same connect without verification
function UntrustedCertificateDialog({
	host,
	open,
	onConfirm,
	onCancel,
}: {
	host: string
	open: boolean
	onConfirm: () => void
	onCancel: () => void
}) {
	const {t} = useTranslation()
	return (
		<AlertDialog open={open} onOpenChange={(stillOpen) => !stillOpen && onCancel()}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{t('files-cloud.untrusted-cert-title')}</AlertDialogTitle>
					<AlertDialogDescription>{t('files-cloud.untrusted-cert-message', {host})}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<Button variant='default' size='dialog' onClick={onCancel}>
						{t('cancel')}
					</Button>
					<AlertDialogAction variant='primary' onClick={onConfirm}>
						{t('files-cloud.untrusted-cert-confirm')}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}

function WebDavConnect({
	flavor,
	reauthAccountId,
	savedConnection,
	onConnected,
	onBack,
}: {
	// A reauthenticating flavored account keeps its stored flavor even though
	// it signs in through the plain form
	flavor?: CloudWebDavFlavorId
	reauthAccountId?: string
	savedConnection?: WebDavConnection
	onConnected: (result: ConnectedResult) => void
	onBack: () => void
}) {
	const {t} = useTranslation()
	const [url, setUrl] = useState(savedConnection?.url ?? '')
	const [username, setUsername] = useState(savedConnection?.username ?? '')
	const [password, setPassword] = useState('')
	const [confirmingCert, setConfirmingCert] = useState(false)
	const {connectWebDav, isConnectingWebDav} = useCloudConnect()

	const canSubmit = Boolean(url.trim() && username.trim() && password) && !isConnectingWebDav
	const submit = async (
		tlsMode: 'default' | 'insecure' = url.trim() === savedConnection?.url ? savedConnection.tlsMode : 'default',
	) => {
		try {
			const result = await connectWebDav({
				flavor: flavor ?? 'webdav',
				url: url.trim(),
				username: username.trim(),
				password,
				tlsMode,
				...(reauthAccountId && {accountId: reauthAccountId}),
			})
			onConnected({accountId: result.account.id, account: result.account, locations: result.locations})
		} catch (error) {
			// An unverifiable certificate asks for consent, then retries insecurely;
			// everything else is toasted by the connect hook
			if ((error as RouterError).message?.includes(UNTRUSTED_CERTIFICATE_CODE)) setConfirmingCert(true)
		}
	}

	return (
		<div className='space-y-4 py-2'>
			<FieldRow label={t('files-cloud.webdav-url')}>
				<Input
					autoFocus
					value={url}
					onValueChange={setUrl}
					placeholder={t('files-cloud.webdav-url-placeholder')}
					autoComplete='off'
					spellCheck={false}
				/>
			</FieldRow>
			<FieldRow label={t('files-cloud.webdav-username')}>
				<Input value={username} onValueChange={setUsername} autoComplete='off' spellCheck={false} />
			</FieldRow>
			<FieldRow label={t('files-cloud.webdav-password')}>
				<PasswordInput value={password} onValueChange={setPassword} />
			</FieldRow>
			<DialogFooter className='flex-col-reverse justify-center gap-2 pt-2'>
				<Button size='dialog' onClick={onBack}>
					{t('back')}
				</Button>
				<Button variant='primary' size='dialog' disabled={!canSubmit} onClick={() => submit()}>
					{isConnectingWebDav ? <Loader2 className='size-4 animate-spin' /> : t('files-cloud.connect')}
				</Button>
			</DialogFooter>
			<UntrustedCertificateDialog
				host={hostOf(url.trim())}
				open={confirmingCert}
				onConfirm={() => {
					setConfirmingCert(false)
					submit('insecure')
				}}
				onCancel={() => setConfirmingCert(false)}
			/>
		</div>
	)
}

// Nextcloud/ownCloud presented on their own terms: the user types the address
// they know ("cloud.example.com") and the WebDAV endpoint is constructed for
// them. Under the hood this is the ordinary webdav connect route.
function WebDavFlavorConnect({
	flavor,
	onConnected,
	onBack,
}: {
	flavor: CloudWebDavFlavorId
	onConnected: (result: ConnectedResult) => void
	onBack: () => void
}) {
	const {t} = useTranslation()
	const [server, setServer] = useState('')
	const [username, setUsername] = useState('')
	const [password, setPassword] = useState('')
	const [confirmingCert, setConfirmingCert] = useState(false)
	const {connectWebDav, isConnectingWebDav} = useCloudConnect()

	const flavorMeta = CLOUD_WEBDAV_FLAVORS.find(({id}) => id === flavor)
	const flavorName = flavorMeta?.displayName ?? flavor
	const urlParams = {provider: flavorName, example: flavorMeta?.exampleUrl, local: flavorMeta?.exampleLocalUrl}

	const canSubmit = Boolean(server.trim() && username.trim() && password) && !isConnectingWebDav
	const submit = async (tlsMode: 'default' | 'insecure' = 'default') => {
		try {
			const result = await connectWebDav({
				flavor,
				url: buildWebDavFlavorUrl(server, username),
				username: username.trim(),
				password,
				tlsMode,
			})
			onConnected({accountId: result.account.id, account: result.account, locations: result.locations})
		} catch (error) {
			if ((error as RouterError).message?.includes(UNTRUSTED_CERTIFICATE_CODE)) setConfirmingCert(true)
		}
	}

	return (
		<div className='space-y-4 py-2'>
			<FieldRow
				label={t('files-cloud.flavor-url', {provider: flavorName})}
				info={t('files-cloud.flavor-url-tooltip', urlParams)}
			>
				<Input
					autoFocus
					value={server}
					onValueChange={setServer}
					placeholder={t('files-cloud.flavor-url-placeholder', urlParams)}
					autoComplete='off'
					spellCheck={false}
				/>
			</FieldRow>
			<FieldRow
				label={t('files-cloud.flavor-username', {provider: flavorName})}
				info={flavor === 'nextcloud' ? t('files-cloud.flavor-username-tooltip-nextcloud') : undefined}
			>
				<Input value={username} onValueChange={setUsername} autoComplete='off' spellCheck={false} />
			</FieldRow>
			<FieldRow
				label={t('files-cloud.flavor-password', {provider: flavorName})}
				info={
					flavor === 'nextcloud'
						? t('files-cloud.flavor-password-tooltip-nextcloud')
						: t('files-cloud.flavor-password-tooltip-owncloud')
				}
			>
				<PasswordInput value={password} onValueChange={setPassword} />
			</FieldRow>
			<DialogFooter className='flex-col-reverse justify-center gap-2 pt-2'>
				<Button size='dialog' onClick={onBack}>
					{t('back')}
				</Button>
				<Button variant='primary' size='dialog' disabled={!canSubmit} onClick={() => submit()}>
					{isConnectingWebDav ? <Loader2 className='size-4 animate-spin' /> : t('files-cloud.connect')}
				</Button>
			</DialogFooter>
			<UntrustedCertificateDialog
				host={hostOf(buildWebDavFlavorUrl(server, username))}
				open={confirmingCert}
				onConfirm={() => {
					setConfirmingCert(false)
					submit('insecure')
				}}
				onCancel={() => setConfirmingCert(false)}
			/>
		</div>
	)
}

function ICloudConnect({
	reauthAccountId,
	onConnected,
	onBack,
}: {
	reauthAccountId?: string
	onConnected: (result: ConnectedResult) => void
	onBack: () => void
}) {
	const {t} = useTranslation()
	const [appleId, setAppleId] = useState('')
	const [password, setPassword] = useState('')
	const [restartNote, setRestartNote] = useState(false)
	const [challenge, setChallenge] = useState<{
		accountId: string
		// rclone's step name: config_2fa is the device-code prompt (where SMS can
		// be requested), config_2fa_phone the phone picker, config_2fa_sms the
		// SMS-code entry
		step: string
		prompt: string
		choices?: {value: string; displayName: string}[]
	} | null>(null)
	const challengeCompletionRef = useRef<Promise<boolean> | null>(null)
	const [isChallengePending, setIsChallengePending] = useState(false)
	const {beginICloud, isBeginningICloud, continueICloud} = useCloudConnect()

	// Returns true when the step advanced (complete, or a follow-up challenge)
	const handleResult = (result: Awaited<ReturnType<typeof continueICloud>>) => {
		if (result.complete) {
			onConnected({accountId: result.accountId, account: result.account, locations: result.locations})
			return true
		}
		setChallenge({accountId: result.accountId, ...result.challenge})
		return true
	}

	const begin = async () => {
		try {
			setRestartNote(false)
			const result = await beginICloud({
				appleId: appleId.trim(),
				password,
				...(reauthAccountId && {accountId: reauthAccountId}),
			})
			handleResult(result)
		} catch {
			// the connect hook shows the error toast
		}
	}

	// A failed challenge spends the backend auth session, so the user restarts from credentials
	const restartAfterFailure = () => {
		setChallenge(null)
		setPassword('')
		setRestartNote(true)
	}

	const submitChallenge = (result: string, failure: 'choice' | 'pin' | 'sms') => {
		if (challengeCompletionRef.current) return challengeCompletionRef.current
		const pendingChallenge = challenge
		if (!pendingChallenge) return Promise.resolve(false)
		setIsChallengePending(true)
		const operation = (async () => {
			try {
				return handleResult(await continueICloud({accountId: pendingChallenge.accountId, result}))
			} catch (error) {
				if (failure === 'pin') {
					// Let the input show its error state, then restart from credentials
					window.setTimeout(restartAfterFailure, 800)
				} else {
					toast.error(
						failure === 'sms'
							? t('files-cloud-error.icloud-sms', {
									message: getFilesErrorMessage((error as RouterError).message),
								})
							: t('files-cloud-error.verify-code', {
									message: getFilesErrorMessage((error as RouterError).message),
								}),
						{area: 'files'},
					)
					restartAfterFailure()
				}
				return false
			}
		})()
		challengeCompletionRef.current = operation
		const clearCompletion = () => {
			if (challengeCompletionRef.current !== operation) return
			challengeCompletionRef.current = null
			setIsChallengePending(false)
		}
		operation.then(clearCompletion, clearCompletion)
		return operation
	}

	// Asks Apple to text a code instead; the next challenge is either the
	// phone picker (arrives with choices) or the SMS-code entry
	const requestSms = () => submitChallenge('sms', 'sms')

	if (challenge) {
		// rclone's device-code prompt mentions typing "sms", which reads wrong
		// next to a numeric pin input and a dedicated button; say it ourselves
		const prompt = challenge.step === 'config_2fa' ? t('files-cloud.icloud-2fa-prompt') : challenge.prompt
		return (
			<div className='py-2'>
				<div className='flex flex-col items-center gap-4 py-4 text-center'>
					<p className='max-w-[340px] text-13 leading-relaxed text-white/60'>{prompt}</p>
					{challenge.choices ? (
						<div className='flex w-full max-w-[280px] flex-col gap-2'>
							{challenge.choices.map((choice) => (
								<Button
									key={choice.value}
									size='dialog'
									disabled={isChallengePending}
									onClick={() => submitChallenge(choice.value, 'choice')}
								>
									{choice.displayName}
								</Button>
							))}
						</div>
					) : (
						<>
							<div className={cn(isChallengePending && 'pointer-events-none opacity-50')}>
								<PinInput
									length={6}
									autoFocus
									disabled={isChallengePending}
									onCodeCheck={(code) => submitChallenge(code, 'pin')}
								/>
							</div>
							{challenge.step === 'config_2fa' && (
								<button
									type='button'
									disabled={isChallengePending}
									onClick={requestSms}
									className='flex items-center gap-1.5 text-13 text-white/50 transition-colors hover:text-white disabled:pointer-events-none disabled:opacity-60'
								>
									{isChallengePending && <Loader2 className='size-3.5 animate-spin' />}
									{t('files-cloud.icloud-2fa-sms')}
								</button>
							)}
						</>
					)}
				</div>
				<DialogFooter className='flex-col-reverse justify-center gap-2 pt-4'>
					<Button size='dialog' disabled={isChallengePending} onClick={restartAfterFailure}>
						{t('cancel')}
					</Button>
				</DialogFooter>
			</div>
		)
	}

	const canSubmit = Boolean(appleId.trim() && password) && !isBeginningICloud
	return (
		<div className='space-y-4 py-2'>
			{restartNote && (
				<p className='rounded-xl border border-white/10 bg-white/5 p-3 text-13 text-white/60'>
					{t('files-cloud.icloud-restart')}
				</p>
			)}
			{/* Apple gates third-party access behind this switch, and sign-in just
			    fails cryptically without it, so it earns a card before the fields */}
			<div className='flex items-start gap-2.5 rounded-xl border border-white/10 bg-white/5 p-3'>
				<Info className='mt-0.5 size-4 shrink-0 text-brand-lighter' />
				<p className='text-12 leading-relaxed text-white/50'>
					{t('files-cloud.icloud-web-access-note')}{' '}
					<span className='text-white/70'>{t('files-cloud.icloud-web-access-path')}</span>
				</p>
			</div>
			<FieldRow label={t('files-cloud.icloud-apple-id')}>
				<Input autoFocus value={appleId} onValueChange={setAppleId} autoComplete='off' spellCheck={false} />
			</FieldRow>
			<FieldRow label={t('files-cloud.icloud-password')}>
				<PasswordInput value={password} onValueChange={setPassword} />
			</FieldRow>
			<p className='text-12 text-white/50'>{t('files-cloud.icloud-note')}</p>
			<DialogFooter className='flex-col-reverse justify-center gap-2 pt-2'>
				<Button size='dialog' onClick={onBack}>
					{t('back')}
				</Button>
				<Button variant='primary' size='dialog' disabled={!canSubmit} onClick={begin}>
					{isBeginningICloud ? <Loader2 className='size-4 animate-spin' /> : t('files-cloud.connect')}
				</Button>
			</DialogFooter>
		</div>
	)
}
