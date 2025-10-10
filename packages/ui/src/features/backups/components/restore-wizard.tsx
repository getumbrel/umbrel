import {zodResolver} from '@hookform/resolvers/zod'
import {formatDistanceToNow} from 'date-fns'
import {AlertOctagon, ArrowLeft, ChevronDown, Loader2, Plus, Server} from 'lucide-react'
import {useMemo, useState} from 'react'
import {FormProvider, useForm, type Resolver, type SubmitHandler} from 'react-hook-form'
import {Trans} from 'react-i18next/TransWithoutContext'
import {TbCalendarTime, TbDatabase} from 'react-icons/tb'
import {Link} from 'react-router-dom'
import {z} from 'zod'

import {ErrorAlert} from '@/components/ui/alert'
import {ImmersiveDialogSeparator} from '@/components/ui/immersive-dialog'
import {BackupDeviceIcon} from '@/features/backups/components/backup-device-icon'
import {ReviewCard} from '@/features/backups/components/review-card'
import {EmptyTile as EmptyCard, LoadingTile as LoadingCard} from '@/features/backups/components/tiles'
import {
	Backup,
	BackupRepository,
	useBackups,
	useConnectToRepository as useBackupsConnect,
	useRestoreBackup as useBackupsRestore,
	useRepositoryBackups,
} from '@/features/backups/hooks/use-backups'
import {isRepoConnected} from '@/features/backups/utils/backup-location-helpers'
import {
	BACKUP_FILE_NAME,
	getDisplayRepositoryPath,
	getRepositoryDisplayName,
	getRepositoryRelativePath,
} from '@/features/backups/utils/filepath-helpers'
import AddNetworkShareDialog from '@/features/files/components/dialogs/add-network-share-dialog'
import {MiniBrowser} from '@/features/files/components/mini-browser'
import {useExternalStorage} from '@/features/files/hooks/use-external-storage'
import {useNetworkStorage} from '@/features/files/hooks/use-network-storage'
import {formatFilesystemDate} from '@/features/files/utils/format-filesystem-date'
import {formatFilesystemSize} from '@/features/files/utils/format-filesystem-size'
import {useLanguage} from '@/hooks/use-language'
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/shadcn-components/ui/alert-dialog'
import {Button} from '@/shadcn-components/ui/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/shadcn-components/ui/dropdown-menu'
import {Input, PasswordInput} from '@/shadcn-components/ui/input'
import {trpcReact} from '@/trpc/trpc'
import {languageCodeToDateLocale} from '@/utils/date-time'
import {t} from '@/utils/i18n'

// ---------------------------------------------
// Types & Schema
// ---------------------------------------------

const restoreExistingSchema = z.object({
	repositoryId: z.string().min(1, {message: t('backups-restore.please-select-repository')}),
	backupId: z.string().min(1, {message: t('backups-restore.please-select-backup')}),
})

// Wizard form values (backupId is optional until selected)
type RestoreWizardValues = {repositoryId: string; backupId?: string}

// Relaxed schema while stepping (backupId optional until step 2)
const wizardExistingSchema: z.ZodType<RestoreWizardValues> = restoreExistingSchema.partial({
	backupId: true,
})

// ---------------------------------------------
// Step enum + labels
// ---------------------------------------------

enum Step {
	Repository = 0,
	Backups = 1,
	Review = 2,
}

const headerMetaForStep = (s: Step) => {
	switch (s) {
		case Step.Repository:
			return {
				title: t('backups-restore.choose-backup-location'),
				subtitle: t('backups-restore.restore-from-nas-or-external'),
			}
		case Step.Backups:
			return {title: t('backups-restore.select-backup'), subtitle: t('backups-restore.select-backup-description')}
		case Step.Review:
			return {title: t('backups.review'), subtitle: t('backups.review-description')}
		default:
			return {title: '', subtitle: ''}
	}
}

// ---------------------------------------------
// Main Component
// ---------------------------------------------

export function BackupsRestoreWizard() {
	const [step, setStep] = useState<Step>(Step.Repository)
	const [repoMode, setRepoMode] = useState<'known' | 'manual'>('known')
	const [manualPath, setManualPath] = useState('')
	const [manualPassword, setManualPassword] = useState('')
	const [confirmOpen, setConfirmOpen] = useState(false)
	const [confirmPassword, setConfirmPassword] = useState('')
	const [confirmError, setConfirmError] = useState('')
	const [isStartingRestore, setIsStartingRestore] = useState(false)

	const form = useForm<RestoreWizardValues>({
		resolver: zodResolver(wizardExistingSchema as any) as unknown as Resolver<RestoreWizardValues>,
		defaultValues: {
			repositoryId: '',
			backupId: '',
		},
		mode: 'onChange',
	})

	// Data: repositories
	const {repositories, isLoadingRepositories: isLoadingRepos} = useBackups()

	// Data: backups for selected repository
	const repositoryId = form.watch('repositoryId')
	const {data: backupsUnsorted, isLoading: isLoadingBackups} = useRepositoryBackups(repositoryId, {
		enabled: !!repositoryId,
		staleTime: 15_000,
	})

	// Sort backups from latest to oldest
	const backups = useMemo(() => {
		if (!backupsUnsorted) return undefined
		return [...backupsUnsorted].sort((a, b) => {
			// Sort by time in descending order (latest first)
			const timeA = a.time ? new Date(a.time).getTime() : 0
			const timeB = b.time ? new Date(b.time).getTime() : 0
			return timeB - timeA
		})
	}, [backupsUnsorted])

	// Watches for gating
	const backupId = form.watch('backupId')

	const canNext =
		step === Step.Repository
			? repoMode === 'known'
				? !!repositoryId
				: manualPath.trim().length > 0 && manualPassword.trim().length > 0 && manualPath.endsWith(BACKUP_FILE_NAME)
			: step === Step.Backups
				? !!backupId
				: true

	// Start restore mutation
	const {restoreBackup} = useBackupsRestore()
	const {connectToRepository, isPending: isConnecting} = useBackupsConnect()
	const verifyPasswordMutation = trpcReact.user.login.useMutation()

	// Step-scoped validation before next
	const next = async () => {
		const fieldsByStep: Record<Step, Array<keyof RestoreWizardValues | string>> = {
			[Step.Repository]: ['repositoryId'],
			[Step.Backups]: ['backupId'],
			[Step.Review]: [],
		}
		const fields = fieldsByStep[step] ?? []
		if (step === Step.Repository && repoMode === 'manual') {
			// Attempt to connect to a manually specified repository
			try {
				// Route enforces auth when a user exists; otherwise allowed during recovery
				// Extract parent directory from backup file path
				const path = manualPath.trim()
				const repositoryPath = path.endsWith(BACKUP_FILE_NAME)
					? path.slice(0, -BACKUP_FILE_NAME.length).replace(/\/$/, '') || '/'
					: path
				const id = await connectToRepository({path: repositoryPath, password: manualPassword})
				form.setValue('repositoryId', id, {shouldValidate: true})
				setStep(Step.Backups)
				return
			} catch {
				// Error toasts are handled in the hook; remain on this step
				return
			}
		}
		const ok = await form.trigger(fields as any, {shouldFocus: true})
		if (!ok) return
		setStep((s) => Math.min(s + 1, Step.Review))
	}

	const back = () => setStep((s) => Math.max(s - 1, Step.Repository))

	// Reset dependent fields when repository changes
	const handleSelectRepository = (repoId: string) => {
		form.reset(
			{
				repositoryId: repoId,
				backupId: '',
			},
			{keepDirty: false, keepTouched: false, keepErrors: false},
		)
	}

	// Selected entities
	const selectedRepo = useMemo(() => repositories?.find((r) => r.id === repositoryId), [repositories, repositoryId])
	const selectedBackup = useMemo(() => backups?.find((b) => b.id === backupId), [backups, backupId])

	// Final submit: start restore
	const onSubmit: SubmitHandler<RestoreWizardValues> = async (values) => {
		const {backupId} = values
		if (!backupId) return
		try {
			await restoreBackup(backupId)
		} catch {
			// Error toasts are handled in the hook; remain on this step
		}
	}

	const handleConfirmRestore = async () => {
		try {
			setConfirmError('')
			if (!confirmPassword.trim()) return

			setIsStartingRestore(true)
			// Verify password without altering auth state
			await verifyPasswordMutation.mutateAsync({password: confirmPassword})
			await onSubmit({repositoryId: '', backupId: backupId || ''})
			// Only close dialog on successful restore
			setConfirmOpen(false)
			setConfirmPassword('')
		} catch (error: any) {
			setConfirmError(error?.message || t('backups-restore.invalid-password'))
		} finally {
			setIsStartingRestore(false)
		}
	}

	return (
		<FormProvider {...form}>
			<div className='flex h-full flex-col'>
				{/* Header */}
				<div className='mb-4'>
					{(() => {
						const h = headerMetaForStep(step)
						return (
							<>
								<div className='text-24 font-medium text-white'>{h.title}</div>
								{h.subtitle ? <div className='text-15 text-white/60'>{h.subtitle}</div> : null}
							</>
						)
					})()}
				</div>
				<div className='pb-4'>
					<ImmersiveDialogSeparator />
				</div>

				{/* Body */}
				<div className='min-h-0 flex-1 overflow-hidden'>
					{step === Step.Repository && (
						<RepositoryStep
							repositories={repositories}
							isLoading={isLoadingRepos}
							selectedId={repositoryId}
							onSelect={handleSelectRepository}
							mode={repoMode}
							onModeChange={setRepoMode}
							manualPath={manualPath}
							onManualPathChange={setManualPath}
							manualPassword={manualPassword}
							onManualPasswordChange={setManualPassword}
						/>
					)}

					{step === Step.Backups && (
						<BackupsStep
							backups={backups as any[] | undefined}
							isLoading={isLoadingBackups}
							selectedId={backupId}
							onSelect={(id) => form.setValue('backupId', id, {shouldValidate: true})}
						/>
					)}

					{step === Step.Review && <ReviewStep repository={selectedRepo} backup={selectedBackup} />}
				</div>

				{/* Footer */}
				<div className='mt-6 flex items-center gap-2 pt-4 max-md:flex-col-reverse'>
					{step !== Step.Repository ? (
						<Button size='dialog' onClick={back} className='min-w-0 max-md:w-full'>
							{t('back')}
						</Button>
					) : null}
					{step !== Step.Review ? (
						<Button
							variant='primary'
							size='dialog'
							onClick={next}
							disabled={!canNext || isConnecting}
							className='min-w-0 max-md:w-full'
						>
							<span className={isConnecting ? 'opacity-0' : 'opacity-100'}>{t('continue')}</span>
							{isConnecting && <Loader2 className='absolute h-4 w-4 animate-spin' />}
						</Button>
					) : (
						<Button
							variant='destructive'
							size='dialog'
							onClick={() => setConfirmOpen(true)}
							className='min-w-0 max-md:w-full'
						>
							{t('backups-restore.restore-umbrel')}
						</Button>
					)}
				</div>

				{/* Confirm restore dialog */}
				<AlertDialog open={confirmOpen} onOpenChange={(o) => setConfirmOpen(o)}>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle className='text-left'>{t('backups-restore.final-confirmation')}</AlertDialogTitle>
							<AlertDialogDescription className='text-left'>
								{t('backups-restore.final-confirmation-description')}
							</AlertDialogDescription>
						</AlertDialogHeader>
						<div className='mt-2'>
							<span className='mb-2 block text-left text-13 opacity-60'>
								{t('backups-restore.enter-password-to-confirm')}
							</span>
							<PasswordInput
								autoFocus
								value={confirmPassword}
								onValueChange={(v) => {
									setConfirmPassword(v)
									setConfirmError('')
								}}
								error={confirmError}
								sizeVariant='short'
							/>
						</div>
						<AlertDialogFooter className='flex justify-start md:justify-start'>
							<AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
							<AlertDialogAction
								variant='destructive'
								disabled={!confirmPassword.trim() || isStartingRestore}
								onClick={handleConfirmRestore}
								hideEnterIcon={true}
							>
								<span className={isStartingRestore ? 'opacity-0' : 'opacity-100'}>
									{t('backups-restore.restore-umbrel')}
								</span>
								{isStartingRestore && <Loader2 className='absolute h-4 w-4 animate-spin' />}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</div>
		</FormProvider>
	)
}

// ---------------------------------------------
// Step 1 — Repositories
// ---------------------------------------------

function RepositoryStep({
	repositories,
	isLoading,
	selectedId,
	onSelect,
	mode,
	onModeChange,
	manualPath,
	onManualPathChange,
	manualPassword,
	onManualPasswordChange,
}: {
	repositories?: BackupRepository[]
	isLoading: boolean
	selectedId?: string
	onSelect: (id: string) => void
	mode: 'known' | 'manual'
	onModeChange: (m: 'known' | 'manual') => void
	manualPath: string
	onManualPathChange: (v: string) => void
	manualPassword: string
	onManualPasswordChange: (v: string) => void
}) {
	const {doesHostHaveMountedShares} = useNetworkStorage()
	const {disks} = useExternalStorage()
	const isConnected = (path: string) => isRepoConnected(path, doesHostHaveMountedShares, disks as any)
	const renderIcon = (path: string) => (
		<>
			<BackupDeviceIcon path={path} connected={isConnected(path)} className='h-8 w-8 opacity-90' />
		</>
	)

	const repoName = (path: string) => getRepositoryDisplayName(path) || t('unknown')

	const repoPathDisplay = (path: string) => getRepositoryRelativePath(path)

	// Simple folder browser state for manual mode
	const [isBrowserOpen, setBrowserOpen] = useState(false)
	const [browserRoot, setBrowserRoot] = useState<string | undefined>(undefined)
	const [isAddNasOpen, setAddNasOpen] = useState(false)

	const [lang] = useLanguage()

	return (
		<div className='space-y-4'>
			<div className='min-h-0 space-y-3'>
				{mode === 'known' ? (
					<>
						{isLoading ? (
							<LoadingCard />
						) : repositories && repositories.length > 0 ? (
							<div className='max-h-[min(60vh,500px)] overflow-y-auto pr-1'>
								<div className='space-y-3'>
									{repositories.map((repo) => {
										const selected = repo.id === selectedId
										return (
											// We do not allow continuing with a disconnected device. If not connected,the row is visually disabled and non-interactive.
											<div
												key={repo.id}
												className={[
													'flex w-full min-w-0 items-center gap-3 rounded-xl border p-4 transition-colors',
													selected
														? 'border-brand bg-brand/15'
														: isConnected(repo.path)
															? 'cursor-pointer border-white/10 bg-white/5 hover:bg-white/10'
															: 'cursor-not-allowed border-white/10 bg-white/5 opacity-60',
												].join(' ')}
												onClick={() => {
													if (!isConnected(repo.path)) return
													onSelect(repo.id)
												}}
												aria-disabled={!isConnected(repo.path)}
												tabIndex={isConnected(repo.path) ? 0 : -1}
												title={!isConnected(repo.path) ? t('backups-configure.not-connected') : undefined}
											>
												<div className='flex items-center gap-2'>
													{/* Connection dot like Configure */}
													<div
														className='grid size-3 place-items-center rounded-full'
														style={{backgroundColor: isConnected(repo.path) ? '#299E163D' : '#DF1F1F3D'}}
													>
														<div
															className='size-1.5 rounded-full'
															style={{backgroundColor: isConnected(repo.path) ? '#299E16' : '#DF1F1F'}}
														/>
													</div>
													{renderIcon(repo.path)}
												</div>
												<div className='min-w-0 flex-1'>
													<div className='whitespace-normal break-words text-sm' title={repo.path}>
														<span className='font-medium'>{repoName(repo.path)}</span>
														<span> · {repoPathDisplay(repo.path)}</span>
													</div>
													<div className='text-[12px] opacity-60'>
														{repo.lastBackup
															? t('backups-restore.last-backup', {
																	date: formatFilesystemDate(Number(repo.lastBackup), lang),
																})
															: t('backups-restore.no-backups-yet')}
													</div>
												</div>
											</div>
										)
									})}
								</div>
							</div>
						) : null}
						{/* Manual add callout row (always shown in known mode) */}
						<div
							className='flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-xl border border-dashed border-white/10 bg-white/5 p-4 transition-colors hover:border-brand hover:bg-brand/15'
							onClick={() => onModeChange('manual')}
						>
							<div className='flex h-10 w-10 shrink-0 items-center justify-center'>
								<div className='flex size-10 items-center justify-center rounded-full bg-white/10'>
									<div className='flex size-7 items-center justify-center rounded-full bg-white/20'>
										<Plus className='size-4' />
									</div>
								</div>
							</div>
							<div className='min-w-0 flex-1'>
								<div className='text-sm font-medium'>{t('backups-restore.restore-from-unlisted')}</div>
								<div className='text-[12px] opacity-60'>{t('backups-restore.browse-nas-or-external')}</div>
							</div>
						</div>
					</>
				) : (
					<div className='space-y-4'>
						{/* Title row with back arrow */}
						<div className='mb-1 flex items-center gap-2'>
							<button
								type='button'
								className='inline-flex items-center justify-center text-white/70 hover:text-white'
								onClick={() => onModeChange('known')}
							>
								<ArrowLeft className='h-4 w-4' />
							</button>
							<div className='text-sm font-medium'>{t('backups-restore.connect-to-backup-location')}</div>
						</div>
						<div>
							<div className='mb-2 text-sm font-medium'>{t('backups-restore.backup-location')}</div>
							<div className='relative'>
								<Input
									type='text'
									value={manualPath}
									readOnly
									className={(manualPath ? 'cursor-pointer ' : 'cursor-default ') + 'select-none pr-28'}
									title={manualPath || ''}
									aria-disabled={!manualPath}
									tabIndex={manualPath ? 0 : -1}
									onClick={() => {
										// We don't allow opening the browser by clicking the input if it is blank (user must click the dropdown to choose nas/external)
										if (!manualPath) return
										// Default to Network if no path is set, otherwise determine from current path
										const root = manualPath?.startsWith('/Network') ? '/Network' : '/External'
										setBrowserRoot(root)
										setBrowserOpen(true)
									}}
								/>
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button
											type='button'
											size='sm'
											className='absolute right-5 top-1/2 inline-flex -translate-y-1/2 items-center gap-1'
										>
											{t('backups-restore.choose')}
											<ChevronDown className='h-3 w-3' />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align='end' className='min-w-[240px]'>
										<DropdownMenuItem
											onSelect={() => {
												setBrowserRoot('/Network')
												setBrowserOpen(true)
											}}
										>
											{t('backups-restore.browse-nas')}
										</DropdownMenuItem>
										<DropdownMenuItem
											onSelect={() => {
												setBrowserRoot('/External')
												setBrowserOpen(true)
											}}
										>
											{t('backups-restore.browse-external')}
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							</div>
						</div>
						<div>
							<div className='mb-2 text-sm font-medium'>{t('backups-restore.encryption-password')}</div>
							<PasswordInput value={manualPassword} onValueChange={onManualPasswordChange} />
						</div>
						<MiniBrowser
							open={isBrowserOpen}
							onOpenChange={setBrowserOpen}
							rootPath={browserRoot || '/'}
							onOpenPath={manualPath || browserRoot || '/'}
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
							// only allow selecting the backup file
							selectableFilter={(entry) => entry.name === BACKUP_FILE_NAME}
							onSelect={(p) => {
								onManualPathChange(p)
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
				)}
			</div>
		</div>
	)
}

// ---------------------------------------------
// Step 2 — Backups in selected repository
// ---------------------------------------------

function BackupsStep({
	backups,
	isLoading,
	selectedId,
	onSelect,
}: {
	backups?: Backup[]
	isLoading: boolean
	selectedId?: string
	onSelect: (id: string) => void
}) {
	const [lang] = useLanguage()
	return (
		<div className='space-y-4'>
			<div className='space-y-2'>
				{isLoading ? (
					<LoadingCard />
				) : !backups || backups.length === 0 ? (
					<EmptyCard text={t('backups-restore.no-backups-found')} />
				) : (
					<div
						className='max-h-[45vh] overflow-hidden overflow-y-auto rounded-2xl bg-gradient-to-b from-white/[0.03] to-transparent pb-8 pl-1 pt-1 md:max-h-[min(60vh,560px)]'
						style={{
							maskImage: 'linear-gradient(to bottom, red 50px calc(100% - 80px), transparent)',
						}}
					>
						<div className='space-y-1'>
							{backups.map((b, i) => {
								const id = b.id ?? ''
								const when = b.time
								const date = when ? new Date(when) : null
								const dateLabel = date ? formatFilesystemDate(when, lang) : t('backups-restore.unknown-date')
								const timeAgo = date
									? formatDistanceToNow(date, {
											addSuffix: true,
											locale: languageCodeToDateLocale[lang] ?? languageCodeToDateLocale.en,
										})
									: ''
								const size = b.size
								const sizeTxt = typeof size === 'number' ? formatFilesystemSize(size) : ''

								const selected = id === selectedId
								const isFirst = i === 0
								const isLast = i === backups.length - 1

								return (
									<div
										key={id || Math.random()}
										className={[
											'group relative flex w-full cursor-pointer items-center gap-4 rounded-12 px-3 py-2 md:px-4 md:py-3.5',
											selected
												? 'bg-gradient-to-r from-brand/20 to-brand/10 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]'
												: 'hover:bg-white/[0.06]',
										].join(' ')}
										onClick={() => id && onSelect(id)}
										title={id}
									>
										{/* Selection indicator */}
										<div className='relative flex size-10 shrink-0 items-center justify-center'>
											{/* Outer ring */}
											<div
												className={[
													'absolute inset-0 rounded-full',
													selected
														? 'bg-gradient-to-br from-brand to-brand/60 shadow-[0_0_20px_rgba(var(--color-brand-rgb),0.3)]'
														: 'bg-white/10 group-hover:bg-white/15',
												].join(' ')}
											/>

											{/* Inner dot */}
											<div
												className={[
													'relative size-4 rounded-full',
													selected
														? 'bg-white shadow-[0_0_10px_rgba(255,255,255,0.5)]'
														: 'bg-white/20 group-hover:bg-white/30',
												].join(' ')}
											/>

											{/* Connecting line */}
											{!isLast && (
												<div className='absolute left-1/2 top-full h-[calc(100%+0.25rem)] w-px -translate-x-1/2 bg-gradient-to-b from-white/10 to-transparent' />
											)}
										</div>

										{/* Content */}
										<div className='min-w-0 flex-1'>
											<div className='flex items-baseline gap-2'>
												<div
													className={[
														'truncate font-medium transition-colors duration-200 max-md:text-sm',
														selected ? 'text-white' : 'text-white/90',
													].join(' ')}
												>
													{dateLabel}
												</div>
												{timeAgo && (
													<div
														className={[
															'shrink-0 text-xs transition-colors duration-200 max-md:hidden',
															selected ? 'text-white/70' : 'text-white/50',
														].join(' ')}
													>
														{timeAgo}
													</div>
												)}
											</div>
											{sizeTxt && (
												<div
													className={[
														'mt-0.5 text-xs transition-colors duration-200',
														selected ? 'text-white/60' : 'text-white/40',
													].join(' ')}
												>
													{sizeTxt}
												</div>
											)}
										</div>

										{/* Latest badge */}
										{isFirst && (
											<div
												className={[
													'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider transition-all duration-200',
													selected ? 'bg-white/20 text-white' : 'bg-white/10 text-white/60',
												].join(' ')}
											>
												{t('backups-restore.latest')}
											</div>
										)}
									</div>
								)
							})}
						</div>
					</div>
				)}
			</div>
		</div>
	)
}

// ---------------------------------------------
// Step 3 — Review
// ---------------------------------------------

function ReviewStep({repository, backup}: {repository?: BackupRepository; backup?: Backup}) {
	const [lang] = useLanguage()
	const when = backup?.time
	const label = when ? formatFilesystemDate(when, lang) : t('backups-restore.unknown-date')
	const size = backup?.size
	const sizeTxt = typeof size === 'number' ? formatFilesystemSize(size) : t('unknown')

	const repoDisplayPath = useMemo(() => {
		const p = repository?.path || ''
		if (!p) return t('backups-restore.unknown-repository')
		const display = getDisplayRepositoryPath(p)
		return display || t('backups-restore.unknown-repository')
	}, [repository?.path])

	return (
		<div className='space-y-4'>
			{/* Cards */}
			<div className='space-y-3'>
				<ReviewCard icon={<Server className='h-5 w-5 opacity-80' />} label={t('backups-restore.backup-location')}>
					<div className='truncate text-sm' title={repoDisplayPath}>
						{repoDisplayPath}
					</div>
				</ReviewCard>
				<ReviewCard icon={<TbCalendarTime className='h-5 w-5 opacity-80' />} label={t('backups-restore.backup-date')}>
					<div className='truncate text-sm' title={label}>
						{label}
					</div>
				</ReviewCard>
				<ReviewCard icon={<TbDatabase className='h-5 w-5 opacity-80' />} label={t('backups-restore.total-size')}>
					<div className='truncate text-sm'>{sizeTxt}</div>
				</ReviewCard>
			</div>

			{/* Warning */}
			{/* Use Trans component to embed Rewind link within translated text using numeric placeholders */}
			<ErrorAlert
				icon={AlertOctagon}
				description={
					<Trans
						i18nKey='backups-restore.restore-warning'
						components={[<Link to='/files?rewind=open' className='underline' key='rewind' />]}
					/>
				}
			/>
		</div>
	)
}
