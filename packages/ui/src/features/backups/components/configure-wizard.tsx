import {ArrowLeft, ChevronDown, Loader2} from 'lucide-react'
import * as React from 'react'
import {useNavigate} from 'react-router-dom'

import {ImmersiveDialogSeparator} from '@/components/ui/immersive-dialog'
import {BackupDeviceIcon} from '@/features/backups/components/backup-device-icon'
import {BackupsExclusions} from '@/features/backups/components/backups-exclusions'
import {useBackupProgress, useBackups, useRepositorySize} from '@/features/backups/hooks/use-backups'
import {isRepoConnected} from '@/features/backups/utils/backup-location-helpers'
import {getDisplayRepositoryPath} from '@/features/backups/utils/filepath-helpers'
import {EXTERNAL_STORAGE_PATH, NETWORK_STORAGE_PATH} from '@/features/files/constants'
import {useExternalStorage} from '@/features/files/hooks/use-external-storage'
import {useNetworkStorage} from '@/features/files/hooks/use-network-storage'
import {formatFilesystemDate} from '@/features/files/utils/format-filesystem-date'
import {formatFilesystemSize} from '@/features/files/utils/format-filesystem-size'
import {useIsSmallMobile} from '@/hooks/use-is-mobile'
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
import {t} from '@/utils/i18n'

// MAIN COMPONENT

export function BackupsConfigureWizard() {
	const navigate = useNavigate()
	const {repositories, backupNow, forgetRepository} = useBackups()
	const {doesHostHaveMountedShares} = useNetworkStorage()
	const {disks} = useExternalStorage()

	const [viewRepoId, setViewRepoId] = React.useState<string | null>(null)
	const viewRepo = (repositories || []).find((r) => r.id === viewRepoId) || null
	const isViewConnected = React.useMemo(
		() => (viewRepo ? isRepoConnected(viewRepo.path, doesHostHaveMountedShares, disks) : false),
		[viewRepo, doesHostHaveMountedShares, disks],
	)
	const repoSizeQ = useRepositorySize(viewRepoId || undefined, {enabled: isViewConnected})

	// Backup progress for disabling buttons and showing inline progress
	const backupProgressQ = useBackupProgress(1000)
	const backupProgressByRepo = React.useMemo(() => {
		const map = new Map<string, number>()
		for (const p of backupProgressQ.data || []) map.set(p.repositoryId, p.percent)
		return map
	}, [backupProgressQ.data])

	const goToSetupNas = React.useCallback(
		() => navigate(`/settings/backups/setup?backups-setup-tab=${NETWORK_STORAGE_PATH.slice(1).toLowerCase()}`),
		[navigate],
	)
	const goToSetupExternal = React.useCallback(
		() => navigate(`/settings/backups/setup?backups-setup-tab=${EXTERNAL_STORAGE_PATH.slice(1).toLowerCase()}`),
		[navigate],
	)
	const goToSetupUmbrelPrivateCloud = React.useCallback(
		() => navigate(`/settings/backups/setup?backups-setup-tab=umbrel-private-cloud`),
		[navigate],
	)

	return (
		<div className='flex h-full flex-col gap-4'>
			<div>
				<h2 className='text-24 font-medium text-white'>{t('backups')}</h2>
			</div>
			<ImmersiveDialogSeparator />

			{!viewRepo ? (
				<>
					<span className='mb-4 text-13 text-white/60'>{t('backups.schedule-description')}</span>
					<LocationsSection
						repositories={repositories || []}
						doesHostHaveMountedShares={doesHostHaveMountedShares}
						disks={disks}
						backupProgressByRepo={backupProgressByRepo}
						onViewRepo={setViewRepoId}
						onBackupNow={backupNow}
						onAddNas={goToSetupNas}
						onAddExternal={goToSetupExternal}
						onAddUmbrelPrivateCloud={goToSetupUmbrelPrivateCloud}
					/>

					<div className='h-2' />
					{/* Global Backups Exclusions */}
					<BackupsExclusions showTitle />
				</>
			) : (
				<RepositoryDetails
					repo={viewRepo as any}
					isConnected={isViewConnected}
					sizeUsed={repoSizeQ.data?.used}
					sizeAvailable={repoSizeQ.data?.available}
					inProgressPercent={viewRepoId ? backupProgressByRepo.get(viewRepoId) : undefined}
					onBack={() => setViewRepoId(null)}
					onBackupNow={() => viewRepoId && backupNow(viewRepoId)}
					onForget={() => viewRepoId && forgetRepository(viewRepoId)}
				/>
			)}
		</div>
	)
}

// SUB COMPONENTS

// Green/red dot to indicate device connectivity
function ConnectivityDot({connected}: {connected: boolean}) {
	const solidCentre = connected ? '#299E16' : '#DF1F1F'
	const lighterRadius = connected ? '#299E163D' : '#DF1F1F3D'
	return (
		<div className='grid size-3 place-items-center rounded-full' style={{backgroundColor: lighterRadius}}>
			<div className='size-1.5 rounded-full' style={{backgroundColor: solidCentre}} />
		</div>
	)
}

// Indicator for in-progress backups
function CircularProgress({percent, className}: {percent: number; className?: string}) {
	const p = Math.max(0, Math.min(100, Math.floor(percent || 0)))
	const radius = 7
	const circumference = 2 * Math.PI * radius
	const dashoffset = circumference - (p / 100) * circumference
	return (
		<svg viewBox='0 0 16 16' className={className} role='img' aria-label={`${p}%`}>
			<circle cx='8' cy='8' r={radius} stroke='currentColor' strokeWidth='2' fill='none' opacity='0.2' />
			<circle
				cx='8'
				cy='8'
				r={radius}
				stroke='currentColor'
				strokeWidth='2'
				fill='none'
				strokeDasharray={circumference}
				strokeDashoffset={dashoffset}
				transform='rotate(-90 8 8)'
			/>
		</svg>
	)
}

function InlineBackupProgress({percent}: {percent: number}) {
	return (
		<div className='flex items-center gap-2 text-sm'>
			<CircularProgress percent={percent} className='size-4' />
			<div>{t('backups-configure.in-progress')}</div>
			<div className='tabular-nums'>{Math.floor(percent)}%</div>
		</div>
	)
}

// Section for showing all backup repositories
function LocationsSection({
	repositories,
	doesHostHaveMountedShares,
	disks,
	backupProgressByRepo,
	onViewRepo,
	onBackupNow,
	onAddNas,
	onAddExternal,
	onAddUmbrelPrivateCloud,
}: {
	repositories: Array<{id: string; path: string; lastBackup?: any}>
	doesHostHaveMountedShares: (rootPath: string) => boolean
	disks: any[] | undefined
	backupProgressByRepo: Map<string, number>
	onViewRepo: (id: string) => void
	onBackupNow: (id: string) => void
	onAddNas: () => void
	onAddExternal: () => void
	onAddUmbrelPrivateCloud: () => void
}) {
	const isSmallMobile = useIsSmallMobile()
	const [lang] = useLanguage()
	return (
		<>
			<div className='space-y-2'>
				<div className='flex items-center justify-between'>
					<span className='text-13 font-medium text-white/90'>{t('backups-configure.locations')}</span>
					{/* Dropdown menu to add a NAS or External drive */}
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button size='sm' className='inline-flex items-center gap-1'>
								{t('backups-configure.add-backup-location')}
								<ChevronDown className='h-3 w-3' />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align='end' className='min-w-[280px]'>
							<DropdownMenuItem onSelect={onAddNas}>
								<div className='flex flex-col'>
									<div className='text-14 font-medium'>{t('backups-setup-umbrel-or-nas')}</div>
									<div className='text-12 text-white/40'>{t('backups-setup-nas-or-umbrel-description')}</div>
								</div>
							</DropdownMenuItem>
							<DropdownMenuItem onSelect={onAddExternal}>
								<div className='flex flex-col'>
									<div className='text-14 font-medium'>{t('external-drive')}</div>
									<div className='text-12 text-white/40'>{t('backups-setup-external-description')}</div>
								</div>
							</DropdownMenuItem>
							<DropdownMenuItem onSelect={onAddUmbrelPrivateCloud}>
								<div className='flex flex-col'>
									<div className='text-14 font-medium'>{t('backups-setup-umbrel-private-cloud')}</div>
									<div className='text-12 text-white/40'>{t('backups-setup-umbrel-private-cloud-description')}</div>
								</div>
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
				{/* List of backup repositories */}
				<div className='divide-y divide-white/6 rounded-12 bg-white/5'>
					{repositories.length === 0 ? (
						<div className='p-5 text-sm text-white/50'>{t('backups-configure.no-backup-locations')}</div>
					) : (
						repositories.map((repo) => {
							const deviceName = repo.path.split('/').filter(Boolean)[1] || repo.path
							const isConnected = isRepoConnected(repo.path, doesHostHaveMountedShares, disks)
							return (
								<div className='flex flex-col gap-0 p-3' key={repo.id}>
									<div className='flex items-center gap-2'>
										<ConnectivityDot connected={isConnected} />
										<BackupDeviceIcon path={repo.path} className='size-8 opacity-90' />
										<div className='min-w-0 flex-1 truncate'>
											<span className='block text-sm font-medium'>{deviceName}</span>
											{isConnected && repo.lastBackup ? (
												<span className='block text-11 text-white/40'>
													{backupProgressByRepo.has(repo.id)
														? t('backups-configure.backing-up-now')
														: `${t('backups-configure.last-backup')} ${formatFilesystemDate(Number(repo.lastBackup), lang)}`}
												</span>
											) : null}
										</div>
										<div className='flex items-center gap-2'>
											{!isSmallMobile && backupProgressByRepo.has(repo.id) ? (
												<InlineBackupProgress percent={backupProgressByRepo.get(repo.id) || 0} />
											) : null}
											{!isSmallMobile && (
												<Button
													size='sm'
													variant='default'
													className={`shrink-0${backupProgressByRepo.has(repo.id) ? ' hidden' : ''}`}
													onClick={() => onBackupNow(repo.id)}
												>
													{t('backups-configure.back-up-now')}
												</Button>
											)}
											<Button size='sm' variant='default' className='shrink-0' onClick={() => onViewRepo(repo.id)}>
												{t('backups-configure.view')}
											</Button>
										</div>
									</div>
								</div>
							)
						})
					)}
				</div>
			</div>
		</>
	)
}

// View details for a single backup repository when user clicks "View"
function RepositoryDetails({
	repo,
	isConnected,
	sizeUsed,
	sizeAvailable,
	inProgressPercent,
	onBack,
	onBackupNow,
	onForget,
}: {
	repo: {id: string; path: string; lastBackup?: any}
	isConnected: boolean
	sizeUsed?: number
	sizeAvailable?: number
	inProgressPercent?: number
	onBack: () => void
	onBackupNow: () => void
	onForget: () => void
}) {
	const [lang] = useLanguage()
	const [confirmRemoveOpen, setConfirmRemoveOpen] = React.useState(false)

	const deviceName = repo.path.split('/').filter(Boolean)[1] || repo.path
	return (
		<div className='space-y-4'>
			<div className='flex items-center gap-2'>
				<span
					role='button'
					tabIndex={0}
					onClick={onBack}
					onKeyDown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault()
							onBack()
						}
					}}
					aria-label={t('back')}
					className='inline-flex h-6 w-6 cursor-pointer items-center justify-center text-white'
				>
					<ArrowLeft className='h-4 w-4' />
				</span>
				<BackupDeviceIcon path={repo.path} className='h-5 w-5 opacity-90' />
				<span className='text-15 font-medium'>{deviceName}</span>
			</div>
			<div className='divide-y divide-white/6 rounded-12 bg-white/5'>
				{/* Connection row */}
				<div className='flex items-center justify-between p-3 text-sm'>
					<div className='text-white/60'>{t('backups-configure.connection')}</div>
					<div className='flex items-center justify-end gap-2'>
						<ConnectivityDot connected={isConnected} />
						<div className='text-right'>
							{isConnected ? t('backups-configure.connected') : t('backups-configure.not-connected')}
						</div>
					</div>
				</div>
				<div className='flex items-center justify-between p-3 text-sm'>
					<div className='text-white/60'>{t('backups-configure.path')}</div>
					<div className='min-w-0 flex-1 truncate text-right'>{getDisplayRepositoryPath(repo.path)}</div>
				</div>
				<div className='flex items-center justify-between p-3 text-sm'>
					<div className='text-white/60'>{t('backups-configure.last-backup')}</div>
					<div className='text-right'>
						{repo.lastBackup
							? formatFilesystemDate(Number(repo.lastBackup), lang)
							: t('backups-restore.no-backups-yet')}
					</div>
				</div>
				<div className='flex items-center justify-between p-3 text-sm'>
					<div className='text-white/60'>{t('backups-configure.status')}</div>
					<div className='flex items-center justify-end gap-2 text-right'>
						{typeof inProgressPercent === 'number' ? (
							<InlineBackupProgress percent={inProgressPercent} />
						) : (
							<div>{t('backups-configure.awaiting-next-backup')}</div>
						)}
					</div>
				</div>
				<div className='flex items-center justify-between p-3 text-sm'>
					<div className='text-white/60'>{t('backups-configure.used')}</div>
					<div className='flex items-center justify-end text-right'>
						{isConnected ? (
							sizeUsed !== undefined ? (
								formatFilesystemSize(sizeUsed)
							) : (
								<Loader2 className='size-4 animate-spin text-white/60' aria-label={t('loading')} />
							)
						) : (
							'—'
						)}
					</div>
				</div>
				<div className='flex items-center justify-between p-3 text-sm'>
					<div className='text-white/60'>{t('backups-configure.available')}</div>
					<div className='flex items-center justify-end text-right'>
						{isConnected ? (
							sizeAvailable !== undefined ? (
								formatFilesystemSize(sizeAvailable)
							) : (
								<Loader2 className='size-4 animate-spin text-white/60' aria-label={t('loading')} />
							)
						) : (
							'—'
						)}
					</div>
				</div>
			</div>
			<div className='flex justify-end gap-2'>
				<Button
					variant='default'
					disabled={!isConnected || typeof inProgressPercent === 'number'}
					onClick={onBackupNow}
				>
					{t('backups-configure.back-up-now')}
				</Button>
				<Button variant='destructive' onClick={() => setConfirmRemoveOpen(true)}>
					{t('backups-configure.remove-backup-location')}
				</Button>
			</div>

			{/* Confirm remove dialog */}
			<AlertDialog open={confirmRemoveOpen} onOpenChange={setConfirmRemoveOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t('backups-configure.remove-backup-location-confirmation')}</AlertDialogTitle>
						<AlertDialogDescription>
							{t('backups-configure.remove-backup-location-confirmation-description', {device: deviceName})}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
						<AlertDialogAction
							variant='destructive'
							onClick={() => {
								onForget()
								setConfirmRemoveOpen(false)
							}}
						>
							{t('backups-configure.remove-backup-location')}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	)
}
