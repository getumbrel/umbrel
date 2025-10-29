import {ChevronLeft, Loader2} from 'lucide-react'
import {useMemo, useState} from 'react'
import {Trans} from 'react-i18next/TransWithoutContext'

import {FadeScroller} from '@/components/fade-scroller'
import {RestoreLocationDropdown} from '@/features/backups/components/restore-location-dropdown'
import {
	useConnectToRepository,
	useRepositoryBackups,
	useRestoreBackup,
	type Backup,
} from '@/features/backups/hooks/use-backups'
import {BACKUP_FILE_NAME, getRepositoryPathFromBackupFile} from '@/features/backups/utils/filepath-helpers'
import {sortBackupsByTimeDesc} from '@/features/backups/utils/sort'
import AddNetworkShareDialog from '@/features/files/components/dialogs/add-network-share-dialog'
import {MiniBrowser} from '@/features/files/components/mini-browser'
import {formatFilesystemDate} from '@/features/files/utils/format-filesystem-date'
import {formatFilesystemSize} from '@/features/files/utils/format-filesystem-size'
import {useLanguage} from '@/hooks/use-language'
import {buttonClass, formGroupClass, Layout} from '@/layouts/bare/shared'
import {OnboardingAction, OnboardingFooter} from '@/routes/onboarding/onboarding-footer'
import {Button} from '@/shadcn-components/ui/button'
import {Input, PasswordInput} from '@/shadcn-components/ui/input'
import {t} from '@/utils/i18n'

export default function BackupsRestoreOnboarding() {
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
	const [connectedRepositoryId, setConnectedRepositoryId] = useState('')
	const [selectedBackupId, setSelectedBackupId] = useState('')

	// Backups hooks
	const {connectToRepository, isPending: isConnecting} = useConnectToRepository()
	const {restoreBackup, isPending: isRestoring} = useRestoreBackup()

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
			} catch {
				// Error toasts are handled in the hook
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
			transitionTitle={false}
			subTitle={stepSubtitle}
			subTitleMaxWidth={630}
			footer={<OnboardingFooter action={OnboardingAction.CREATE_ACCOUNT} />}
		>
			<div className='mx-auto mb-6 mt-2 w-full max-w-[720px]'>
				{step === 0 && (
					<div className='space-y-4'>
						<div className={formGroupClass + ' mx-auto w-full max-w-[560px] text-center'}>
							<div className='relative text-left'>
								<Input
									type='text'
									value={repositoryPath}
									readOnly
									className={(repositoryPath ? 'cursor-pointer ' : 'cursor-default ') + 'select-none pr-28'}
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
								/>
							</div>
						</div>
					</div>
				)}

				{step === Step.Password && (
					<div className='space-y-4'>
						<div className={formGroupClass + ' mx-auto w-full max-w-[560px] text-center'}>
							<div className='mx-auto w-full max-w-[560px]'>
								<PasswordInput
									value={encryptionPassword}
									onValueChange={setEncryptionPassword}
									autoFocus
									label={t('backups-restore.encryption-password')}
								/>
							</div>
						</div>
					</div>
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
								<div className='text-center text-xs opacity-60'>{t('backups-restore.no-backups-found')}</div>
							) : (
								<FadeScroller direction='y' className='max-h-[45vh] overflow-y-auto pr-1'>
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
							className='flex size-10 items-center justify-center rounded-full border border-white/10 bg-white/5 transition-colors duration-300 hover:bg-white/10 focus-visible:border-white/50 focus-visible:bg-white/10 focus-visible:outline-none'
							onClick={() => setStep((s) => (s === 0 ? 0 : ((s - 1) as 0 | 1 | 2)))}
						>
							<ChevronLeft className='size-5' />
						</button>
					)}
					{step < Step.Review ? (
						<button
							type='button'
							className={buttonClass + ' ' + (!canNext || isConnecting ? 'pointer-events-none opacity-50' : '')}
							onClick={handleNext}
							disabled={!canNext || isConnecting}
						>
							<span className={isConnecting ? 'opacity-0' : 'opacity-100'}>{t('continue')}</span>
							{isConnecting && <Loader2 className='absolute size-4 animate-spin' />}
						</button>
					) : (
						<button
							type='button'
							className={buttonClass + ' ' + (isRestoring ? 'pointer-events-none opacity-50' : '')}
							onClick={async () => {
								try {
									await restoreBackup(selectedBackupId)
								} catch {
									// Error toasts are handled in the hook
								}
							}}
							disabled={!selectedBackupId || isRestoring}
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
					onClick ? 'cursor-pointer' : '',
				].join(' ')}
				onClick={onClick}
				title={backup.id}
			>
				<div className='min-w-0 flex-1'>
					<div className='truncate text-sm'>{label}</div>
				</div>
				{isLatest && (
					<div className='mr-2 shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide opacity-80'>
						{t('backups-restore.latest')}
					</div>
				)}
				{sizeTxt && (
					<div className='shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide opacity-80'>
						{sizeTxt}
					</div>
				)}
			</div>
		</div>
	)
}
