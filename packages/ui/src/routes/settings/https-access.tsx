import {ChevronDown} from 'lucide-react'
import React from 'react'
import {useTranslation} from 'react-i18next'
import {TbAlertTriangle} from 'react-icons/tb'

import {FadeScroller} from '@/components/fade-scroller'
import {Button} from '@/components/ui/button'
import {CopyButton} from '@/components/ui/copy-button'
import {Dialog, DialogContent, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from '@/components/ui/dropdown-menu'
import {toast} from '@/components/ui/toast'
import androidIcon from '@/features/files/assets/sharing-info-platforms/android.png'
import iOsIcon from '@/features/files/assets/sharing-info-platforms/ios.png'
import macOsIcon from '@/features/files/assets/sharing-info-platforms/macos.png'
import windowsIcon from '@/features/files/assets/sharing-info-platforms/windows.png'
import {InlineCopyableField} from '@/features/files/components/dialogs/share-info-dialog/platform-instructions/inline-copyable-field'
import {formatFilesystemDateOnly} from '@/features/files/utils/format-filesystem-date'
import {authorizedHttpUrl} from '@/modules/auth/http-auth'
import {useConfirmation} from '@/providers/confirmation'
import {BackButton} from '@/routes/settings/_components/shared'
import {trpcReact} from '@/trpc/trpc'
import {SupportedLanguageCode} from '@/utils/language'
import {tw} from '@/utils/tw'

type HttpsCertificatePlatform = {
	id: 'macos' | 'ios' | 'windows' | 'android'
	name: string
	image: string
}

type HttpsCertificateServerSans = {
	dns: string[]
	ips: string[]
}

const httpsCertificatePlatforms: HttpsCertificatePlatform[] = [
	{id: 'macos', name: 'macOS', image: macOsIcon},
	{id: 'windows', name: 'Windows', image: windowsIcon},
	{id: 'ios', name: 'iOS', image: iOsIcon},
	{id: 'android', name: 'Android', image: androidIcon},
]

export function HttpsAccessInstructions({secureUrl}: {secureUrl: string}) {
	const {t} = useTranslation()

	return (
		<InstructionContainer>
			<InstructionStep>
				<span className='flex min-w-0 flex-wrap items-center gap-1'>
					<span>{t('https-access-open-at')}</span>
					<InlineCopyableField value={secureUrl} className='max-w-full min-w-0' />
				</span>
			</InstructionStep>
			<InstructionStep>
				<span className='block'>
					<span>{t('https-access-browser-step-warning')}</span>
					<span className='mt-1 block text-[11px] leading-tight text-white/60'>
						{t('https-access-browser-step-warning-caution')}
					</span>
				</span>
			</InstructionStep>
		</InstructionContainer>
	)
}

export function HttpsCertificateSettingsPanel({onBack}: {onBack: () => void}) {
	const {t} = useTranslation()
	const confirm = useConfirmation()
	const utils = trpcReact.useUtils()
	const statusQ = trpcReact.lanIngress.getCertificateStatus.useQuery()
	const resetCaMut = trpcReact.lanIngress.resetCa.useMutation()
	const [selectedPlatform, setSelectedPlatform] = React.useState<HttpsCertificatePlatform>(httpsCertificatePlatforms[0])
	const status = statusQ.data
	const secureUrl = `https://${window.location.host}`

	const invalidate = () => utils.lanIngress.getCertificateStatus.invalidate()

	const downloadCa = async () => {
		if (!status?.caCertificate) return
		// A real navigation instead of a blob download so iOS Safari can offer
		// its configuration profile install flow for the certificate.
		window.location.href = await authorizedHttpUrl('/lan-ingress/umbrel-local-ca.crt')
	}

	const resetCertificate = async () => {
		try {
			const result = await confirm({
				title: t('https-access-reset-confirm-title'),
				message: t('https-access-reset-confirm-description'),
				actions: [
					{label: t('https-access-reset-confirm-action'), value: 'confirm', variant: 'destructive'},
					{label: t('cancel'), value: 'cancel', variant: 'default'},
				],
			})
			if (result.actionValue !== 'confirm') return
		} catch {
			return
		}

		try {
			await resetCaMut.mutateAsync()
			await invalidate()
		} catch (error) {
			const message = error instanceof Error ? error.message : t('unknown-error')
			toast.error(t('https-access-reset-error', {message}), {area: 'settings'})
		}
	}

	return (
		<div className='flex flex-col gap-y-5'>
			<BackButton onClick={onBack}>{t('https-access-network-title')}</BackButton>
			<div className='space-y-1 px-1'>
				<h3 className='text-18 leading-tight font-semibold'>{t('https-access-certificate-settings-title')}</h3>
				<p className='text-13 leading-tight text-white/45'>{t('https-access-certificate-settings-description')}</p>
			</div>
			<div className='flex items-start gap-3 rounded-12 bg-[#F5A623]/10 p-3'>
				<TbAlertTriangle className='mt-0.5 size-5 shrink-0 text-[#F5A623]' />
				<div className='flex flex-col gap-1'>
					<span className='text-13 leading-tight font-semibold text-[#F5A623]'>
						{t('https-access-certificate-warning-title')}
					</span>
					<span className='text-12 leading-tight text-white/60'>{t('https-access-certificate-warning')}</span>
				</div>
			</div>
			<HttpsCertificateSummary
				caExpiresAt={status?.caExpiresAt}
				caFingerprint={status?.caFingerprint}
				serverSans={status?.serverSans}
				onDownload={downloadCa}
				canDownload={!!status?.caCertificate && !statusQ.isLoading}
				onReset={() => void resetCertificate()}
				canReset={!statusQ.isLoading && !resetCaMut.isPending}
			/>
			<HttpsCertificatePlatformSelector selectedPlatform={selectedPlatform} onPlatformChange={setSelectedPlatform} />
			<HttpsCertificateInstructions platform={selectedPlatform} secureUrl={secureUrl} />
		</div>
	)
}

function HttpsCertificateSummary({
	caExpiresAt,
	caFingerprint,
	serverSans,
	onDownload,
	canDownload,
	onReset,
	canReset,
}: {
	caExpiresAt?: string
	caFingerprint?: string
	serverSans?: HttpsCertificateServerSans
	onDownload: () => void
	canDownload: boolean
	onReset: () => void
	canReset: boolean
}) {
	const {t} = useTranslation()
	const [showDetails, setShowDetails] = React.useState(false)

	return (
		<>
			<div className='flex flex-wrap items-center justify-between gap-3 px-1'>
				<div className='flex flex-wrap items-center gap-2'>
					<Button size='sm' onClick={onDownload} disabled={!canDownload}>
						{t('https-access-download-certificate')}
					</Button>
					<button
						type='button'
						onClick={() => setShowDetails(true)}
						className='text-12 font-medium text-white/45 transition-colors hover:text-white/65'
					>
						{t('https-access-certificate-details')}
					</button>
				</div>
				<button
					type='button'
					onClick={onReset}
					disabled={!canReset}
					className='text-12 font-medium text-destructive transition-opacity hover:opacity-80 disabled:opacity-50'
				>
					{t('https-access-reset-certificate')}
				</button>
			</div>
			<Dialog open={showDetails} onOpenChange={setShowDetails}>
				<DialogContent className='p-0'>
					<div className='space-y-6 px-5 py-6'>
						<DialogHeader>
							<DialogTitle>{t('https-access-certificate-details')}</DialogTitle>
						</DialogHeader>
						<HttpsCertificateDetails caExpiresAt={caExpiresAt} caFingerprint={caFingerprint} serverSans={serverSans} />
					</div>
				</DialogContent>
			</Dialog>
		</>
	)
}

function HttpsCertificateDetails({
	caExpiresAt,
	caFingerprint,
	serverSans,
}: {
	caExpiresAt?: string
	caFingerprint?: string
	serverSans?: HttpsCertificateServerSans
}) {
	const {t, i18n} = useTranslation()
	const certificateAddresses = [...(serverSans?.dns ?? []), ...(serverSans?.ips ?? [])].filter(
		(value) => value !== 'localhost' && value !== '127.0.0.1',
	)
	const expiry = caExpiresAt ? formatCertificateDate(caExpiresAt, i18n.language) : ''

	return (
		<div className={detailListClass}>
			<CertificateDetailRow label={t('https-access-certificate-name-label')}>
				{t('https-access-certificate-name')}
			</CertificateDetailRow>
			<CertificateDetailRow label={t('https-access-certificate-type')}>
				{t('https-access-certificate-type-ca')}
			</CertificateDetailRow>
			{expiry && <CertificateDetailRow label={t('https-access-certificate-expires')}>{expiry}</CertificateDetailRow>}
			{caFingerprint && (
				<div className='space-y-2 px-3 py-3 text-15 font-medium -tracking-3'>
					<div>{t('https-access-certificate-fingerprint')}</div>
					<CertificateCopyField value={caFingerprint} />
				</div>
			)}
			{certificateAddresses.length > 0 && (
				<div className='space-y-2 px-3 py-3 text-15 font-medium -tracking-3'>
					<div>{t('https-access-certificate-umbrel-addresses')}</div>
					<div className='umbrel-stable-gutter max-h-28 overflow-auto text-13 leading-snug font-normal break-words text-white/60'>
						{certificateAddresses.join(', ')}
					</div>
				</div>
			)}
		</div>
	)
}

function formatCertificateDate(value: string, locale: string) {
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) return ''
	return formatFilesystemDateOnly(date.getTime(), locale as SupportedLanguageCode)
}

function CertificateCopyField({value}: {value: string}) {
	return (
		<div className='flex max-w-full items-center rounded-4 border border-dashed border-white/5 bg-white/4 text-14 leading-none text-white/40'>
			<FadeScroller
				direction='x'
				className='umbrel-hide-scrollbar min-w-0 flex-1 overflow-x-auto py-1 pl-2.5 font-mono text-11 whitespace-nowrap'
			>
				{value}
			</FadeScroller>
			<div className='shrink-0 px-1.5'>
				<CopyButton value={value} />
			</div>
		</div>
	)
}

function CertificateDetailRow({label, children}: {label: string; children: React.ReactNode}) {
	return (
		<div className={detailRowClass}>
			<span className='shrink-0'>{label}</span>
			<span className='min-w-0 text-right font-normal'>{children}</span>
		</div>
	)
}

function HttpsCertificatePlatformSelector({
	selectedPlatform,
	onPlatformChange,
}: {
	selectedPlatform: HttpsCertificatePlatform
	onPlatformChange: (platform: HttpsCertificatePlatform) => void
}) {
	const {t} = useTranslation()

	return (
		<div className='flex items-center justify-between'>
			<span className='text-14'>{t('https-access-setup-platform-label')}</span>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant='default' className='flex items-center gap-2'>
						<HttpsCertificatePlatformIcon platform={selectedPlatform} />
						<span>{selectedPlatform.name}</span>
						<ChevronDown className='h-3 w-3' />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent className='w-[200px]'>
					{httpsCertificatePlatforms.map((platform) => (
						<DropdownMenuItem
							key={platform.id}
							className='flex items-center gap-2'
							onClick={() => onPlatformChange(platform)}
						>
							<HttpsCertificatePlatformIcon platform={platform} />
							<span>{platform.name}</span>
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	)
}

function HttpsCertificatePlatformIcon({platform}: {platform: HttpsCertificatePlatform}) {
	return <img src={platform.image} alt={platform.name} className='h-5 w-5' />
}

function HttpsCertificateInstructions({platform, secureUrl}: {platform: HttpsCertificatePlatform; secureUrl: string}) {
	const {t} = useTranslation()

	if (platform.id === 'macos') {
		return (
			<HttpsCertificateInstructionSet secureUrl={secureUrl} showFirefoxNote>
				<InstructionStep>
					{t('https-access-instructions.macos.download', {button: t('https-access-download-certificate')})}
				</InstructionStep>
				<InstructionStep>{t('https-access-instructions.macos.add-system')}</InstructionStep>
				<InstructionStep>{t('https-access-instructions.macos.open-keychain')}</InstructionStep>
				<InstructionStep>{t('https-access-instructions.macos.drag-certificate')}</InstructionStep>
				<InstructionStep>{t('https-access-instructions.macos.find-certificate')}</InstructionStep>
				<InstructionStep>{t('https-access-instructions.macos.always-trust')}</InstructionStep>
				<InstructionStep>{t('https-access-instructions.macos.close-confirm')}</InstructionStep>
				<InstructionStep>{t('https-access-instructions.macos.restart-browser')}</InstructionStep>
			</HttpsCertificateInstructionSet>
		)
	}

	if (platform.id === 'ios') {
		return (
			<HttpsCertificateInstructionSet secureUrl={secureUrl}>
				<InstructionStep>
					{t('https-access-instructions.ios.download', {button: t('https-access-download-certificate')})}
				</InstructionStep>
				<InstructionStep>{t('https-access-instructions.ios.allow-profile')}</InstructionStep>
				<InstructionStep>{t('https-access-instructions.ios.profile-downloaded')}</InstructionStep>
				<InstructionStep>{t('https-access-instructions.ios.install-profile')}</InstructionStep>
				<InstructionStep>{t('https-access-instructions.ios.certificate-trust-settings')}</InstructionStep>
				<InstructionStep>{t('https-access-instructions.ios.full-trust')}</InstructionStep>
				<InstructionStep>{t('https-access-instructions.ios.continue-warning')}</InstructionStep>
			</HttpsCertificateInstructionSet>
		)
	}

	if (platform.id === 'windows') {
		return (
			<HttpsCertificateInstructionSet secureUrl={secureUrl} showFirefoxNote>
				<InstructionStep>
					{t('https-access-instructions.windows.download', {button: t('https-access-download-certificate')})}
				</InstructionStep>
				<InstructionStep>{t('https-access-instructions.windows.install-certificate')}</InstructionStep>
				<InstructionStep>{t('https-access-instructions.windows.local-machine')}</InstructionStep>
				<InstructionStep>{t('https-access-instructions.windows.place-store')}</InstructionStep>
				<InstructionStep>{t('https-access-instructions.windows.trusted-root')}</InstructionStep>
				<InstructionStep>{t('https-access-instructions.windows.finish')}</InstructionStep>
				<InstructionStep>{t('https-access-instructions.windows.confirm-warning')}</InstructionStep>
				<InstructionStep>{t('https-access-instructions.windows.restart-browser')}</InstructionStep>
			</HttpsCertificateInstructionSet>
		)
	}

	return (
		// No Firefox note here: Firefox on Android has a different setting for user CAs
		// than the desktop note describes.
		<HttpsCertificateInstructionSet secureUrl={secureUrl}>
			<InstructionStep>
				{t('https-access-instructions.android.download', {button: t('https-access-download-certificate')})}
			</InstructionStep>
			<InstructionStep>{t('https-access-instructions.android.open-settings')}</InstructionStep>
			<InstructionStep>{t('https-access-instructions.android.install-certificate')}</InstructionStep>
			<InstructionStep>{t('https-access-instructions.android.install-anyway')}</InstructionStep>
			<InstructionStep>{t('https-access-instructions.android.choose-file')}</InstructionStep>
			<InstructionStep>{t('https-access-instructions.android.restart-browser')}</InstructionStep>
		</HttpsCertificateInstructionSet>
	)
}

function HttpsCertificateInstructionSet({
	children,
	secureUrl,
	showFirefoxNote = false,
}: {
	children: React.ReactNode
	secureUrl: string
	showFirefoxNote?: boolean
}) {
	const {t} = useTranslation()

	return (
		<div className='space-y-2'>
			<InstructionContainer>
				{children}
				<InstructionStep>
					<span className='space-y-1'>
						<span className='flex min-w-0 flex-wrap items-center gap-1'>
							<span>{t('https-access-open-at')}</span>
							<InlineCopyableField value={secureUrl} className='max-w-full min-w-0' />
						</span>
						{showFirefoxNote && (
							<span className='block text-[11px] leading-tight font-medium text-white/45'>
								{t('https-access-instructions.firefox-note')}
							</span>
						)}
					</span>
				</InstructionStep>
			</InstructionContainer>
			<div className='px-1 text-11 leading-tight font-medium text-white/35'>
				{t('https-access-instructions-version-note')}
			</div>
		</div>
	)
}

function InstructionContainer({children}: {children: React.ReactNode}) {
	return <div className='divide-y divide-white/6 overflow-hidden rounded-12 bg-white/6'>{children}</div>
}

function InstructionStep({children}: {children: React.ReactNode}) {
	return (
		<div className='flex flex-col gap-2 p-3 text-12 font-medium -tracking-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3'>
			<span className='min-w-0 leading-tight'>{children}</span>
		</div>
	)
}

const detailListClass = tw`divide-y divide-white/6 overflow-hidden rounded-12 bg-white/6`
const detailRowClass = tw`flex items-center gap-3 px-3 h-[42px] text-15 font-medium -tracking-3 justify-between`
