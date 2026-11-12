import {ChevronLeft, Loader2} from 'lucide-react'
import {useMemo, useState} from 'react'
import {Trans, useTranslation} from 'react-i18next'
import {Link} from 'react-router-dom'

import {FadeScroller} from '@/components/fade-scroller'
import {Button} from '@/components/ui/button'
import {Input, PasswordInput} from '@/components/ui/input'
import {RestoreLocationDropdown} from '@/features/backups/components/restore-location-dropdown'
import {
	useConnectToRepository,
	useRepositoryBackups,
	useRestoreBackup,
	type Backup,
} from '@/features/backups/hooks/use-backups'
import {getUserFriendlyErrorMessage} from '@/features/backups/utils/error-messages'
import {BACKUP_FILE_NAME, getRepositoryPathFromBackupFile} from '@/features/backups/utils/filepath-helpers'
import {sortBackupsByTimeDesc} from '@/features/backups/utils/sort'
import AddNetworkShareDialog from '@/features/files/components/dialogs/add-network-share-dialog'
import {MiniBrowser} from '@/features/files/components/mini-browser'
import {useExternalStorage} from '@/features/files/hooks/use-external-storage'
import {formatFilesystemDate} from '@/features/files/utils/format-filesystem-date'
import {formatFilesystemSize} from '@/features/files/utils/format-filesystem-size'
import {deviceInfoToHostEnvironment} from '@/hooks/use-device-info'
import {useLanguage} from '@/hooks/use-language'
import {formGroupClass, Layout, primaryButtonProps} from '@/layouts/bare/shared'
import {cn} from '@/lib/utils'
import {OnboardingAction, OnboardingFooter} from '@/routes/onboarding/onboarding-footer'
import {getGenericRaidOnboardingPath} from '@/routes/onboarding/storage-selection'
import {trpcReact} from '@/trpc/trpc'

// Restoring during onboarding puts the backup on the boot drive. A device that keeps
// its data on a storage pool has to create that pool first, which happens as part of
// creating an account: always on Umbrel Pro, and on generic hardware when it has
// internal drives to set up (the same check that sends account creation to storage
// setup). Those devices are told to set up with a temporary account and restore from
// Settings; everything else restores right here.
export default function BackupsRestoreOnboarding() {
	const {t} = useTranslation()
	const identityQ = trpcReact.systemNg.device.getIdentity.useQuery()
	const host = deviceInfoToHostEnvironment(identityQ.data)
	const internalStorageQ = trpcReact.hardware.internalStorage.getDevices.useQuery(undefined, {
		enabled: host === 'unknown',
	})

	// Only a check with no answer yet counts: a background refetch must not take the
	// restore flow off screen
	const checks = [identityQ, internalStorageQ]

	if (checks.some((check) => check.isFetching && check.data === undefined)) {
		return (
			<Layout
				title={t('backups-restore-header')}
				subTitle=''
				footer={<OnboardingFooter action={OnboardingAction.CREATE_ACCOUNT} />}
			>
				<div className='flex items-center justify-center py-12'>
					<Loader2 className='size-6 animate-spin text-white/50' />
				</div>
			</Layout>
		)
	}

	// Without an answer there's no telling where the restore would land, so don't guess
	if (checks.some((check) => check.isLoadingError)) {
		return (
			<Layout
				title={t('backups-restore-header')}
				subTitle={t('storage-status.check-failed')}
				subTitleMaxWidth={630}
				footer={<OnboardingFooter action={OnboardingAction.CREATE_ACCOUNT} />}
			>
				<button
					type='button'
					{...primaryButtonProps}
					onClick={() => {
						for (const check of checks) if (check.isLoadingError) void check.refetch()
					}}
				>
					{t('storage-status.check-again')}
				</button>
			</Layout>
		)
	}

	if (host === 'umbrel-pro') {
		return <SetUpFirstInstructions subTitle={t('backups-restore-setup-first.subtitle-pro')} />
	}

	if (host === 'unknown' && internalStorageQ.data && getGenericRaidOnboardingPath(internalStorageQ.data)) {
		return <SetUpFirstInstructions subTitle={t('backups-restore-setup-first.subtitle-internal-storage')} />
	}

	return <RegularRestoreFlow />
}

// The way to restore on a device that has storage to set up: finish onboarding with a
// temporary account, then restore from Settings
function SetUpFirstInstructions({subTitle}: {subTitle: string}) {
	const {t} = useTranslation()
	const steps = [
		t('backups-restore-setup-first.step1'),
		<Trans
			t={t}
			key='step2'
			i18nKey='backups-restore-setup-first.step2'
			components={[<span key='path' className='font-medium text-white' />]}
		/>,
		t('backups-restore-setup-first.step3'),
	]

	return (
		<Layout
			title={t('backups-restore-header')}
			subTitle={subTitle}
			subTitleMaxWidth={630}
			footer={<OnboardingFooter action={OnboardingAction.CREATE_ACCOUNT} />}
		>
			<div className='mx-auto mt-2 mb-6 w-full max-w-[560px]'>
				{/* Steps */}
				<div className='divide-y divide-white/6 overflow-hidden rounded-12 bg-white/6'>
					{steps.map((text, i) => (
						<div key={i} className='flex items-center gap-3 p-3 text-13 font-medium -tracking-3'>
							<div className='flex size-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-11 text-white/60'>
								{i + 1}
							</div>
							<div className='flex-1 text-white/70'>{text}</div>
						</div>
					))}
				</div>

				<p className='mt-4 text-center text-13 text-white/50'>{t('backups-restore-setup-first.after-restore')}</p>

				{/* Action button */}
				<div className='flex justify-center pt-6'>
					<Link to='/onboarding/create-account' viewTransition {...primaryButtonProps}>
						{t('onboarding.start.continue')}
					</Link>
				</div>
			</div>
		</Layout>
	)
}

// Restores straight from a backup, for devices with no storage to set up first
function RegularRestoreFlow() {
	const {t} = useTranslation()
	const title = t('backups-restore-header')
	const [lang] = useLanguage()

	// Steps
	enum Step {
		ChooseLocation = 0,
		Password = 1,
		Backups = 2,
		Review = 3,
	}
	const [step, setStep] = useState<Step>(Step.ChooseLocation)

	// Repository connection state
	const [repositoryPath, setRepositoryPath] = useState('')
	const [encryptionPassword, setEncryptionPassword] = useState('')
	const [passwordError, setPasswordError] = useState('')
	const [connectedRepositoryId, setConnectedRepositoryId] = useState('')
	const [selectedBackupId, setSelectedBackupId] = useState('')

	// Backups hooks
	const {connectToRepository, isPending: isConnecting} = useConnectToRepository({toastErrors: false})
	const {restoreBackup, isPending: isRestoring} = useRestoreBackup()
	const {isExternalStorageSupported} = useExternalStorage()

	// Fetch backups when repository connected
	const {data: backupsUnsorted, isLoading: isLoadingBackups} = useRepositoryBackups(connectedRepositoryId, {
		enabled: !!connectedRepositoryId,
		staleTime: 15_000,
	})

	const backups = useMemo(
		(): Backup[] => sortBackupsByTimeDesc(backupsUnsorted as Backup[] | undefined),
		[backupsUnsorted],
	)

	// Reuse MiniBrowser for browsing, with AddNetworkShareDialog for discovery
	const [isBrowserOpen, setBrowserOpen] = useState(false)
	const [browserRoot, setBrowserRoot] = useState<string | undefined>(undefined)
	const [isAddNasOpen, setAddNasOpen] = useState(false)

	// Subtitles per-step
	const stepSubtitle =
		step === Step.ChooseLocation
			? t('backups-restore.restore-from-nas-or-external')
			: step === Step.Password
				? t('backups-restore.encryption-password-description')
				: step === Step.Backups
					? t('backups-restore.select-backup-description')
					: t('backups-restore.review-description')

	const canContinueFromAddDevice = repositoryPath.trim().length > 0 && repositoryPath.endsWith(BACKUP_FILE_NAME)

	// Validation per-step
	const canNext =
		step === Step.ChooseLocation
			? canContinueFromAddDevice
			: step === Step.Password
				? !!encryptionPassword.trim()
				: step === Step.Backups
					? !!selectedBackupId
					: true

	async function handleNext() {
		if (step === Step.ChooseLocation) {
			setStep(Step.Password)
			return
		}
		if (step === Step.Password) {
			try {
				// Extract parent directory from backup file path
				const parentPath = getRepositoryPathFromBackupFile(repositoryPath)
				const id = await connectToRepository({path: parentPath, password: encryptionPassword})
				setConnectedRepositoryId(id)
				setStep(Step.Backups)
			} catch (error) {
				setPasswordError(getUserFriendlyErrorMessage(error))
			}
			return
		}
		if (step === Step.Backups) {
			setStep(Step.Review)
			return
		}
	}

	return (
		<Layout
			title={title}
			subTitle={stepSubtitle}
			subTitleMaxWidth={630}
			footer={<OnboardingFooter action={OnboardingAction.CREATE_ACCOUNT} />}
		>
			<div className='mx-auto mt-2 mb-6 w-full max-w-[720px]'>
				{step === 0 && (
					<div className='space-y-4'>
						<div className={formGroupClass + ' mx-auto w-full max-w-[560px] text-center'}>
							<div className='relative text-left'>
								<Input
									type='text'
									value={repositoryPath}
									readOnly
									// Clears the Choose button, which grows with the text size
									className='pr-[calc(7rem+var(--text-boost)*8)]'
									title={repositoryPath || ''}
									aria-disabled={!repositoryPath}
									tabIndex={repositoryPath ? 0 : -1}
									onClick={() => {
										if (!repositoryPath) return
										const root = repositoryPath.startsWith('/Network') ? '/Network' : '/External'
										setBrowserRoot(root)
										setBrowserOpen(true)
									}}
								/>
								<RestoreLocationDropdown
									onSelect={(root) => {
										setBrowserRoot(root)
										setBrowserOpen(true)
									}}
									isExternalStorageSupported={isExternalStorageSupported}
								/>
							</div>
						</div>
					</div>
				)}

				{step === Step.Password && (
					// A form so that Enter continues, as the Continue button does
					<form
						className='space-y-4'
						onSubmit={(e) => {
							e.preventDefault()
							if (canNext && !isConnecting) handleNext()
						}}
					>
						<div className={formGroupClass + ' mx-auto w-full max-w-[560px] text-center'}>
							<div className='mx-auto w-full max-w-[560px]'>
								<PasswordInput
									value={encryptionPassword}
									onValueChange={(password) => {
										setEncryptionPassword(password)
										setPasswordError('')
									}}
									autoFocus
									label={t('backups-restore.encryption-password')}
									error={passwordError}
								/>
							</div>
						</div>
					</form>
				)}

				{step === Step.Backups && (
					<div className='space-y-4'>
						<div className='mx-auto w-full max-w-[560px]'>
							{isLoadingBackups ? (
								<div className='flex items-center justify-center gap-2 py-6 text-white/70'>
									<Loader2 className='size-4 animate-spin' aria-hidden='true' />
									<span>{t('files-listing.loading')}</span>
								</div>
							) : backups.length === 0 ? (
								<div className='text-center text-xs text-white/60'>{t('backups-restore.no-backups-found')}</div>
							) : (
								<FadeScroller direction='y' className='umbrel-stable-gutter max-h-[45vh] overflow-y-auto'>
									<div className='space-y-2'>
										{backups.map((backup, i) => {
											const selected = backup.id === selectedBackupId
											const isLatest = i === 0
											return (
												<BackupSnapshot
													key={backup.id}
													backup={backup}
													selected={selected}
													onClick={() => setSelectedBackupId(backup.id)}
													lang={lang}
													isLatest={isLatest}
												/>
											)
										})}
									</div>
								</FadeScroller>
							)}
						</div>
					</div>
				)}

				{step === Step.Review && (
					<div className='space-y-4 text-center'>
						<span className='text-center text-sm'>{t('backups-restore.restoring-from')}</span>

						{/* Backup snapshot */}
						<div className='mx-auto w-full max-w-[560px] text-left'>
							{(() => {
								const backup = backups.find((x) => x.id === selectedBackupId)
								if (!backup) return null

								const backupIndex = backups.findIndex((x) => x.id === selectedBackupId)
								const isLatest = backupIndex === 0

								return (
									<BackupSnapshot backup={backup} selected={false} lang={lang} noHover={true} isLatest={isLatest} />
								)
							})()}
						</div>
					</div>
				)}

				<div className='mt-6 flex items-center justify-center gap-2 pt-4'>
					{step > Step.ChooseLocation && (
						<button
							type='button'
							className='flex size-10 items-center justify-center rounded-full border border-white/10 bg-white/5 transition-colors duration-300 hover:bg-white/10 focus-visible:border-white/50 focus-visible:bg-white/10 focus-visible:outline-hidden'
							onClick={() => {
								setPasswordError('')
								setStep((s) => (s === 0 ? 0 : ((s - 1) as 0 | 1 | 2)))
							}}
						>
							<ChevronLeft className='size-5' />
						</button>
					)}
					{step < Step.Review ? (
						<button
							type='button'
							className={cn(
								primaryButtonProps.className,
								!canNext || (isConnecting && 'pointer-events-none opacity-50'),
							)}
							onClick={handleNext}
							disabled={!canNext || isConnecting}
							style={primaryButtonProps.style}
						>
							<span className={isConnecting ? 'opacity-0' : 'opacity-100'}>{t('continue')}</span>
							{isConnecting && <Loader2 className='absolute size-4 animate-spin' />}
						</button>
					) : (
						<button
							type='button'
							className={cn(primaryButtonProps.className, isRestoring && 'pointer-events-none opacity-50')}
							onClick={async () => {
								try {
									await restoreBackup(selectedBackupId)
								} catch {
									// Error toasts are handled in the hook
								}
							}}
							disabled={!selectedBackupId || isRestoring}
							style={primaryButtonProps.style}
						>
							<span className={isRestoring ? 'opacity-0' : 'opacity-100'}>{t('backups-restore')}</span>
							{isRestoring && <Loader2 className='absolute size-4 animate-spin' />}
						</button>
					)}
				</div>

				{/* MiniBrowser for repository path selection */}
				<MiniBrowser
					open={isBrowserOpen}
					onOpenChange={setBrowserOpen}
					rootPath={browserRoot || '/'}
					onOpenPath={repositoryPath || browserRoot || '/'}
					preselectOnOpen={true}
					selectionMode='folders'
					title={t('backups-restore.select-backup-file')}
					subtitle={
						<Trans
							t={t}
							i18nKey='backups-restore.select-backup-file-only'
							values={{backupFileName: BACKUP_FILE_NAME}}
							components={{
								bold: <span className='text-brand-lightest' />,
							}}
						/>
					}
					selectableFilter={(entry) => entry.name === BACKUP_FILE_NAME}
					onSelect={(p) => {
						setRepositoryPath(p)
						setBrowserOpen(false)
					}}
					actions={
						browserRoot === '/Network' ? (
							<Button size='sm' variant='default' onClick={() => setAddNasOpen(true)}>
								{t('backups.add-umbrel-or-nas')}
							</Button>
						) : null
					}
				/>

				{/* NAS discovery dialog; reopens MiniBrowser on success */}
				<AddNetworkShareDialog
					open={isAddNasOpen}
					onOpenChange={(v) => setAddNasOpen(v)}
					suppressNavigateOnAdd
					onAdded={() => {
						setBrowserRoot('/Network')
						setBrowserOpen(true)
					}}
				/>
			</div>
		</Layout>
	)
}

function BackupSnapshot({
	backup,
	selected = false,
	onClick,
	lang,
	noHover = false,
	isLatest = false,
}: {
	backup: Backup
	selected?: boolean
	onClick?: () => void
	lang: string
	noHover?: boolean
	isLatest?: boolean
}) {
	const {t} = useTranslation()
	const when = backup.time
	const label = when ? formatFilesystemDate(when, lang as any) : t('backups-restore.unknown-date')
	const size = backup.size
	const sizeTxt = typeof size === 'number' ? formatFilesystemSize(size) : t('unknown')

	return (
		<div className='relative'>
			<div
				className={[
					'flex w-full items-center justify-between rounded-8 border px-4 py-3',
					selected ? 'border-brand bg-brand/15' : 'border-white/10',
					!noHover && !selected ? 'hover:bg-white/5' : '',
					'',
				].join(' ')}
				onClick={onClick}
			>
				<div className='min-w-0 flex-1'>
					<div className='truncate text-sm'>{label}</div>
				</div>
				{isLatest && (
					<div className='mr-2 shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[10px] tracking-wide uppercase opacity-80'>
						{t('backups-restore.latest')}
					</div>
				)}
				{sizeTxt && (
					<div className='shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[10px] tracking-wide uppercase opacity-80'>
						{sizeTxt}
					</div>
				)}
			</div>
		</div>
	)
}
