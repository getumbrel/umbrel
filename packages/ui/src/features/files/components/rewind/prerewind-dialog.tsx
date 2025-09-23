import {ChevronDown, Server} from 'lucide-react'
import {useState} from 'react'
import {TbHistory} from 'react-icons/tb'

import {BackupDeviceIcon} from '@/features/backups/components/backup-device-icon'
import {getRepositoryDisplayName} from '@/features/backups/utils/filepath-helpers'
import {RewindIcon} from '@/features/files/assets/rewind-icon'
import {formatFilesystemDate} from '@/features/files/utils/format-filesystem-date'
import {useLanguage} from '@/hooks/use-language'
import {Button} from '@/shadcn-components/ui/button'
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle} from '@/shadcn-components/ui/dialog'
import {Popover, PopoverContent, PopoverTrigger} from '@/shadcn-components/ui/popover'
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
	const [popoverOpen, setPopoverOpen] = useState(false)
	const list = repos || []
	const activeId = pendingRepoId ?? list[0]?.id ?? ''
	const active = list.find((r) => r.id === activeId) || null
	const path: string = active?.path || ''
	const iconNode = path ? <BackupDeviceIcon path={path} className='size-8' /> : <Server className='size-8 opacity-80' />
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
							<Popover modal open={popoverOpen} onOpenChange={setPopoverOpen}>
								<PopoverTrigger asChild>
									<button
										type='button'
										className='flex w-full min-w-0 items-center justify-between rounded-xl border border-white/10 bg-white/5 p-3 text-left hover:bg-white/10'
									>
										<span className='flex min-w-0 items-center gap-3'>
											{iconNode}
											<span className='min-w-0 truncate'>
												<span className='block text-sm font-medium'>{makeName(path)}</span>
												{active ? (
													<span className='block text-11 opacity-60'>{makeLastBackupText(active.lastBackup)}</span>
												) : null}
											</span>
										</span>
										<ChevronDown className='size-4 opacity-70' />
									</button>
								</PopoverTrigger>
								<PopoverContent
									align='start'
									className='z-[60] w-[var(--radix-popover-trigger-width)] max-w-[92vw] rounded-xl p-1'
									data-ft-repo-popover
									onOpenAutoFocus={(e) => e.preventDefault()}
									onCloseAutoFocus={(e) => e.preventDefault()}
								>
									<div className='space-y-1'>
										{list.map((r) => {
											const p = r.path || ''
											const sel = r.id === activeId
											const icon = p ? (
												<BackupDeviceIcon path={p} className='size-8' />
											) : (
												<Server className='size-8 opacity-80' />
											)
											return (
												<button
													type='button'
													key={r.id}
													className={[
														'flex w-full min-w-0 items-center gap-3 rounded-xl border p-2 text-left',
														sel ? 'border-brand bg-brand/15' : 'border-none hover:bg-white/10 focus:bg-white/10',
													].join(' ')}
													onClick={() => {
														setPendingRepoId(r.id)
														setPopoverOpen(false)
													}}
												>
													{icon}
													<span className='min-w-0 truncate'>
														<span className='block text-sm font-medium'>{makeName(p)}</span>
														<span className='block text-11 opacity-60'>{makeLastBackupText(r.lastBackup)}</span>
													</span>
												</button>
											)
										})}
									</div>
								</PopoverContent>
							</Popover>
						</>
					)}
				</div>
				<DialogFooter className='mt-2 gap-2 pt-2'>
					<Button
						variant='primary'
						size='dialog'
						disabled={!list.length}
						onClick={() => {
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
