import {ChevronDown, Server} from 'lucide-react'
import {TbHistory} from 'react-icons/tb'

import {BackupDeviceIcon} from '@/features/backups/components/backup-device-icon'
import {isRepoConnected} from '@/features/backups/utils/backup-location-helpers'
import {getRepositoryDisplayName} from '@/features/backups/utils/filepath-helpers'
import {RewindIcon} from '@/features/files/assets/rewind-icon'
import {useExternalStorage} from '@/features/files/hooks/use-external-storage'
import {useNetworkStorage} from '@/features/files/hooks/use-network-storage'
import {formatFilesystemDate} from '@/features/files/utils/format-filesystem-date'
import {useLanguage} from '@/hooks/use-language'
import {Button} from '@/shadcn-components/ui/button'
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle} from '@/shadcn-components/ui/dialog'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/shadcn-components/ui/dropdown-menu'
import {t} from '@/utils/i18n'

// We show this dialog when the user clicks Rewind in Files to select a backup repository
export function PreRewindDialog({
	open,
	onOpenChange,
	repos,
	pendingRepoId,
	setPendingRepoId,
	onStart,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	repos: Array<{id: string; path: string; lastBackup?: any}> | undefined
	pendingRepoId: string | null
	setPendingRepoId: (id: string) => void
	onStart: (repoId: string) => void
}) {
	const [lang] = useLanguage()
	const {doesHostHaveMountedShares} = useNetworkStorage()
	const {disks} = useExternalStorage()
	const list = repos || []
	const activeId = pendingRepoId ?? list[0]?.id ?? ''
	const active = list.find((r) => r.id === activeId) || null
	const path: string = active?.path || ''
	const makeName = (p: string) => {
		const name = getRepositoryDisplayName(p)
		if (name) return name
		// Defensive fallbacks for malformed paths (should not occur)
		if (p.startsWith('/Network/')) return t('nas')
		if (p.startsWith('/External/')) return t('external-drive')
		return t('unknown')
	}
	const makeLastBackupText = (lastBackup: any) => {
		if (!lastBackup) return t('backups-restore.no-backups-yet')
		return `${t('backups-configure.last-backup')}: ${formatFilesystemDate(Number(lastBackup), lang)}`
	}

	const connectedById = new Map<string, boolean>(
		list.map((r) => [r.id, isRepoConnected(r.path, doesHostHaveMountedShares, disks as any)]),
	)
	// Selected repo connectivity: when false, we disable entering Rewind and show inactive indicators
	const isActiveConnected = active ? Boolean(connectedById.get(active.id)) : false

	const iconNode = path ? (
		<BackupDeviceIcon path={path} connected={isActiveConnected} className='size-8' />
	) : (
		<Server className='size-8 opacity-80' />
	)

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className='flex flex-col'
				onInteractOutside={(e: any) => {
					const target = e?.detail?.originalEvent?.target || e?.target
					if (target instanceof HTMLElement && target.closest('[data-ft-repo-popover]')) {
						e.preventDefault()
					}
				}}
				onPointerDownOutside={(e: any) => {
					const target = e?.target
					if (target instanceof HTMLElement && target.closest('[data-ft-repo-popover]')) {
						e.preventDefault()
					}
				}}
			>
				<div className='flex flex-col items-start gap-1'>
					<RewindIcon className='size-20' />
					<DialogTitle>{t('backups-rewind')}</DialogTitle>
					<DialogDescription className='text-white/80'>{t('rewind.preflight.description')}</DialogDescription>
				</div>
				<div className='mt-2'>
					{list.length === 0 ? (
						<div className='flex w-full min-w-0 flex-wrap items-start gap-1 rounded-xl border border-white/10 bg-white/5 p-3 text-left text-white/80'>
							<TbHistory className='mt-[1px] size-4 shrink-0' />
							<span className='min-w-0 flex-1 whitespace-normal break-words text-[13px] md:truncate md:whitespace-nowrap'>
								{t('rewind.preflight.enable-backups')}
							</span>
						</div>
					) : (
						<>
							<div className='mb-2 text-13 font-medium text-white/90'>{t('backups.backup-location')}</div>
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<button
										type='button'
										className='flex w-full min-w-0 items-center justify-between rounded-xl border border-white/10 bg-white/5 p-3 text-left hover:bg-white/10'
									>
										<span className='flex min-w-0 items-center gap-3'>
											{iconNode}
											<span className='min-w-0 truncate'>
												<span className='block text-sm font-medium'>{makeName(path)}</span>
												{active ? (
													<>
														<span className='block text-11 leading-tight opacity-60'>
															{makeLastBackupText(active.lastBackup)}
														</span>
														{!isActiveConnected ? (
															<span className='mt-1 block text-11 leading-tight opacity-60'>
																<span className='inline-flex items-center gap-1'>
																	{t('backups-configure.not-connected')}
																	<span
																		className='grid size-3 place-items-center rounded-full'
																		style={{backgroundColor: '#DF1F1F3D'}}
																	>
																		<span className='size-1.5 rounded-full' style={{backgroundColor: '#DF1F1F'}} />
																	</span>
																</span>
															</span>
														) : null}
													</>
												) : null}
											</span>
										</span>
										<ChevronDown className='size-4 opacity-70' />
									</button>
								</DropdownMenuTrigger>
								<DropdownMenuContent
									align='start'
									className='z-[60] w-[var(--radix-dropdown-menu-trigger-width)] max-w-[92vw] rounded-xl p-1'
									data-ft-repo-popover
								>
									<div className='space-y-1'>
										{list.map((r) => {
											const p = r.path || ''
											const sel = r.id === activeId
											const connected = Boolean(connectedById.get(r.id))
											const icon = p ? (
												<BackupDeviceIcon path={p} connected={connected} className='size-8' />
											) : (
												<Server className='size-8 opacity-80' />
											)
											return (
												<DropdownMenuItem
													key={r.id}
													className={[
														'w-full px-2 py-1.5',
														sel ? 'border border-brand bg-brand/15' : 'border border-transparent hover:bg-white/10',
														!connected ? 'opacity-60' : '',
													].join(' ')}
													onClick={() => {
														setPendingRepoId(r.id)
													}}
												>
													<span className='flex min-w-0 items-center gap-3'>
														{icon}
														<span className='min-w-0 truncate'>
															<span className='block text-sm font-medium'>{makeName(p)}</span>
															<span className='block text-11 opacity-60'>{makeLastBackupText(r.lastBackup)}</span>
															{!connected ? (
																<span className='inline-flex items-center gap-1 text-11 opacity-60'>
																	{t('backups-configure.not-connected')}
																	<span
																		className='grid size-3 place-items-center rounded-full'
																		style={{backgroundColor: '#DF1F1F3D'}}
																	>
																		<span className='size-1.5 rounded-full' style={{backgroundColor: '#DF1F1F'}} />
																	</span>
																</span>
															) : null}
														</span>
													</span>
												</DropdownMenuItem>
											)
										})}
									</div>
								</DropdownMenuContent>
							</DropdownMenu>
						</>
					)}
				</div>
				<DialogFooter className='mt-2 gap-2 pt-2'>
					{/* We disable the Start Rewind button if the selected repo's device isn't connected */}
					<Button
						variant='primary'
						size='dialog'
						disabled={!list.length || !isActiveConnected}
						onClick={() => {
							if (!isActiveConnected) return
							const repo = pendingRepoId ?? list[0]?.id ?? null
							if (!repo) return
							onStart(repo)
						}}
					>
						{t('backups-rewind.start')}
					</Button>
					<Button size='dialog' onClick={() => onOpenChange(false)}>
						{t('cancel')}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
