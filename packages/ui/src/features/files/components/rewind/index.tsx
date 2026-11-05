import * as DialogPrimitive from '@radix-ui/react-dialog'
import {MotionConfig} from 'motion/react'
import {useEffect, useMemo, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {useSearchParams} from 'react-router-dom'

import {ChevronDown} from '@/components/chevron-down'
import {Button} from '@/components/ui/button'
import {Dialog} from '@/components/ui/dialog'
import {DialogCloseButton} from '@/components/ui/dialog-close-button'
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {TooltipProvider} from '@/components/ui/tooltip'
import {ChevronLeftIcon} from '@/features/files/assets/chevron-left'
import {ChevronRightIcon} from '@/features/files/assets/chevron-right'
import {RewindIcon} from '@/features/files/assets/rewind-icon'
import {CloudBreakDiagram} from '@/features/files/components/cloud-break-diagram'
import {useRewindOverlay} from '@/features/files/components/rewind/overlay-context'
import {PreRewindDialog} from '@/features/files/components/rewind/prerewind-dialog'
import {RestoreProgressDialog} from '@/features/files/components/rewind/restore-progress-dialog'
import {SnapshotCarousel} from '@/features/files/components/rewind/snapshot-carousel'
import {getSnapshotDateLabel} from '@/features/files/components/rewind/snapshot-date-label'
import {TimelineBar as TimelineBarComponent} from '@/features/files/components/rewind/timeline-bar'
import {cloudSyncName, useCloudAccounts, useCloudActions, useCloudSyncs} from '@/features/files/hooks/use-cloud'
import {useFilesOperations} from '@/features/files/hooks/use-files-operations'
import {useRewind} from '@/features/files/hooks/use-rewind'
import {useFilesStore} from '@/features/files/store/use-files-store'
import {cloudAccountBrand, cloudsOverlappingPath} from '@/features/files/utils/cloud'
import {formatFilesystemDate} from '@/features/files/utils/format-filesystem-date'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {useLanguage} from '@/hooks/use-language'
import {cn} from '@/lib/utils'
import {useConfirmation} from '@/providers/confirmation'
import {useWallpaper} from '@/providers/wallpaper'

import {groupRestoreByDestination} from './restore-grouping'

export function SidebarRewind() {
	const {t} = useTranslation()
	const {setRepoOpen} = useRewindOverlay()

	return (
		<div className='mt-2 mr-4 flex flex-col rounded-xl'>
			<div
				className={cn(
					'flex w-full items-center gap-1.5 rounded-lg border border-transparent from-white/[0.04] to-white/[0.08] text-12',
					'text-white/60 hover:bg-white/10 hover:bg-linear-to-b hover:text-white',
				)}
			>
				<button className='flex w-full items-center gap-[0.45rem] px-2 py-1.5' onClick={() => setRepoOpen(true)}>
					<RewindIcon className='size-5' />
					<span className='truncate'>{t('backups-rewind')}</span>
				</button>
			</div>
		</div>
	)
}

export function RewindOverlay() {
	const {t} = useTranslation()
	const isMobile = useIsMobile()
	const explorerContainerRef = useRef<HTMLDivElement | null>(null)
	const explorerScale = 0.8
	const {overlayOpen, setOverlayOpen, repoOpen, setRepoOpen} = useRewindOverlay()
	const [searchParams, setSearchParams] = useSearchParams()

	// Check for rewind=open parameter and open dialog if present
	// We use this to redirect the user from restore to rewind
	// if they don't want to do a full restore
	useEffect(() => {
		if (searchParams.get('rewind') === 'open') {
			setRepoOpen(true)
			// Remove the parameter from URL
			searchParams.delete('rewind')
			setSearchParams(searchParams, {replace: true})
		}
	}, [searchParams, setSearchParams, setRepoOpen])

	const {
		view,
		repositories,
		repositoriesLoaded,
		backupsRaw,
		backupsLoading,
		backupsForTimeline,
		activeIndex,
		earliestDateLabel,
		setSelectedRepoId,
		pendingRepoId,
		setPendingRepoId,
		selectedBackupId,
		setSelectedBackupId,
		mountedDir,
		selectSnapshot,
		unmountIfNeeded,
		canRecover,
	} = useRewind({overlayOpen, repoOpen})
	const [lang] = useLanguage()
	const {resolveCopyCollisionsOrAbort} = useFilesOperations()
	const {data: clouds} = useCloudSyncs()
	const {data: accounts} = useCloudAccounts()
	const {restoreFiles} = useCloudActions()
	const confirm = useConfirmation()

	const explorerVisible = view !== 'switching-snapshot'
	const [restoreModalOpen, setRestoreModalOpen] = useState(false)
	const [restorePhase, setRestorePhase] = useState<'idle' | 'running' | 'success' | 'error'>('idle')
	const isSwitching = view === 'switching-snapshot'
	const isRestoring = restorePhase === 'running'

	const handleRecoverSelected = async () => {
		if (!canRecover || !mountedDir) return
		try {
			const groups = groupRestoreByDestination(useFilesStore.getState().selectedItems, mountedDir)

			// Complete every collision choice before changing Cloud state.
			const workItems: {path: string; toDirectory: string; collision: 'error' | 'replace' | 'keep-both'}[] = []
			for (const [destDir, paths] of groups) {
				const items = await resolveCopyCollisionsOrAbort({fromPaths: paths, toDirectory: destDir})
				workItems.push(...items)
			}
			if (workItems.length === 0) return

			// Restoring into an active cloud destination is rejected by the
			// backend (the mirror is read-only, and the next sync would revert the
			// restored files anyway). Offer to stop the affected clouds instead:
			// their local files are kept and the folders become ordinary folders.
			// Overlap is checked per restored item's target path, not the shared
			// destination directory: restoring one folder into /Home must not
			// implicate sibling mirrors that also live under /Home.
			const targetPaths = workItems.map(
				({path, toDirectory}) => `${toDirectory}/${path.split('/').filter(Boolean).at(-1)}`,
			)
			const affectedClouds = [
				...new Map(
					targetPaths
						.flatMap((targetPath) => cloudsOverlappingPath(clouds, targetPath))
						.map((cloud) => [cloud.id, cloud] as const),
				).values(),
			]
			if (affectedClouds.length > 0) {
				// One brand logo when the affected clouds agree, generic cloud otherwise
				const brands = new Set(
					affectedClouds.map((cloud) => {
						const account = accounts?.find(({id}) => id === cloud.accountId)
						return account ? cloudAccountBrand(account) : 'cloud'
					}),
				)
				const diagramProvider = brands.size === 1 ? [...brands][0] : undefined
				try {
					await confirm({
						title: t('files-cloud.rewind-confirm-title'),
						message: (
							<>
								<CloudBreakDiagram provider={diagramProvider} />
								{t('files-cloud.rewind-confirm-message', {
									folders: affectedClouds.map(cloudSyncName).join(', '),
								})}
							</>
						),
						actions: [
							{label: t('files-cloud.rewind-confirm-action'), value: 'remove', variant: 'destructive'},
							{label: t('cancel'), value: 'cancel', variant: 'default'},
						],
					})
				} catch {
					// User cancelled the restore
					return
				}
			}

			// Show progress modal and yield before executing copies
			setRestorePhase('running')
			setRestoreModalOpen(true)
			await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))

			// The backend pauses affected mirrors, restores every item, and
			// removes their definitions only after all copies succeed.
			await restoreFiles(
				affectedClouds.map(({id}) => id),
				workItems,
			)

			// Immediately show success, then briefly pause before closing and navigating back to "Now"
			setRestorePhase('success')
			// Show success for 1 second to avoid janky flashing for quick operations
			const successPauseMs = 1000
			setTimeout(async () => {
				setRestoreModalOpen(false)
				setRestorePhase('idle')
				await selectSnapshot('current')
			}, successPauseMs)
		} catch {
			setRestorePhase('error')
		}
	}

	const snapshotsCount = backupsRaw.length
	const countLabel = backupsLoading
		? t('rewind.loading-snapshots')
		: snapshotsCount === 0
			? t('backups-restore.no-backups-yet')
			: t('rewind.snapshots-count', {count: snapshotsCount})

	const handleOpenChange = async (isOpen: boolean) => {
		if (!isOpen) await unmountIfNeeded()
		setOverlayOpen(isOpen)
	}

	const {wallpaper} = useWallpaper()
	const carousel = useMemo(
		() => (
			<SnapshotCarousel
				backupsForTimeline={backupsForTimeline}
				activeIndex={activeIndex}
				noCarousel={isMobile}
				explorerVisible={explorerVisible}
				explorerScale={explorerScale}
				lang={lang}
				wallpaperUrl={wallpaper?.url}
				mountedDir={mountedDir}
				explorerContainerRef={explorerContainerRef}
			/>
		),
		[backupsForTimeline, activeIndex, isMobile, explorerVisible, explorerScale, lang, wallpaper?.url, mountedDir],
	)

	return (
		<TooltipProvider>
			<PreRewindDialog
				open={repoOpen}
				onOpenChange={setRepoOpen}
				repos={repositoriesLoaded ? repositories : undefined}
				pendingRepoId={pendingRepoId}
				setPendingRepoId={(id) => setPendingRepoId(id)}
				onStart={(repo) => {
					setSelectedRepoId(repo)
					setSelectedBackupId('current')
					setRepoOpen(false)
					setOverlayOpen(true)
				}}
			/>

			<Dialog open={overlayOpen} onOpenChange={handleOpenChange}>
				<DialogPrimitive.Portal>
					<DialogPrimitive.Overlay className='fixed inset-0 z-50 bg-black' />
					<DialogPrimitive.Content className='fixed inset-0 z-50 m-0 h-svh w-screen translate-x-0 translate-y-0 rounded-none p-0 outline-hidden'>
						<div className='flex size-full flex-col'>
							{/* Upper area with centered card */}
							<div className='flex flex-[2] items-center justify-center px-2 py-4 md:px-4 md:py-10'>
								<div className='flex w-full max-w-[980px] flex-col items-center gap-4'>
									{/* Date indicator */}
									<div className='text-center text-sm'>
										<span className='text-white/60'>{t('rewind.files-as-of')} </span>
										{/* Desktop: static date label */}
										<span className='hidden text-white md:inline'>
											{getSnapshotDateLabel(selectedBackupId, backupsRaw as any[], lang as any)}
										</span>
										{/* Mobile: inline dropdown selector */}
										<span className='ml-1 inline md:hidden'>
											<DropdownMenu>
												<DropdownMenuTrigger asChild>
													<Button
														size='sm'
														className='h-7 justify-between px-2'
														aria-label={t('rewind')}
														variant='secondary'
														disabled={isSwitching || isRestoring || backupsForTimeline.length === 0}
													>
														<span className='truncate'>
															{getSnapshotDateLabel(selectedBackupId, backupsRaw as any[], lang as any)}
														</span>
														<span className='opacity-70'>
															<ChevronDown />
														</span>
													</Button>
												</DropdownMenuTrigger>
												<DropdownMenuContent
													align='center'
													className='umbrel-stable-gutter max-h-[60vh] overflow-y-auto overscroll-contain p-2.5'
												>
													{backupsForTimeline.map((b) => (
														<DropdownMenuCheckboxItem
															key={b.id}
															checked={selectedBackupId === b.id}
															onSelect={() => selectSnapshot(b.id)}
														>
															{b.id === 'current' ? t('rewind.now') : formatFilesystemDate(b.time, lang)}
														</DropdownMenuCheckboxItem>
													))}
												</DropdownMenuContent>
											</DropdownMenu>
										</span>
									</div>
									<div className='relative h-[68vh] w-full md:h-[64vh]'>
										<MotionConfig transition={{type: 'tween', ease: [0.25, 0.1, 0.25, 1], duration: 0.6}}>
											{carousel}
										</MotionConfig>
									</div>
									<Button
										size='dialog'
										variant='secondary'
										className='w-auto min-w-[150px] md:min-w-[80px]'
										onClick={handleRecoverSelected}
										disabled={isSwitching || isRestoring || !canRecover}
									>
										{t('rewind.restore-selected')}
									</Button>
								</div>
							</div>
							{/* Bottom controls (snapshot # summary + timeline + control buttons). Mobile: use safe-area bottom padding and hide snapshot metadata to avoid browser UI overlap */}
							<div className='flex flex-1 flex-col gap-3 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] md:px-6 md:pb-0'>
								<div className='flex items-center justify-between' />
								<div className='flex w-full flex-col items-stretch gap-3 md:flex-row md:items-center'>
									<div className='flex flex-col items-center text-center md:items-start md:text-left'>
										<div className='hidden items-center gap-2 md:flex'>
											<RewindIcon className='size-5 md:size-6' />
											<div className='text-base leading-none font-semibold text-white md:text-lg'>
												{t('backups-rewind')}
											</div>
										</div>
										<div className='mt-1 hidden min-w-0 items-center gap-1 text-xs text-white/70 md:block md:h-8'>
											<div className='flex flex-col'>
												<span className={backupsLoading ? 'opacity-50' : ''}>{countLabel}</span>
												{snapshotsCount > 0 && earliestDateLabel && !backupsLoading ? (
													<span className='truncate'>{earliestDateLabel}</span>
												) : null}
											</div>
										</div>
									</div>
									<div className='relative order-2 mx-0 w-full min-w-0 flex-1 px-0 md:order-none md:mx-2 md:w-auto md:px-0'>
										{/* Desktop timeline */}
										<div className='hidden md:block'>
											<TimelineBarComponent
												backups={backupsForTimeline}
												selectedId={selectedBackupId}
												onSelect={(id) => {
													selectSnapshot(id)
												}}
											/>
										</div>
									</div>
									<div className='order-3 hidden w-full items-center justify-center gap-2 md:order-none md:flex md:w-auto md:justify-end'>
										{(() => {
											const idx = selectedBackupId ? backupsForTimeline.findIndex((b) => b.id === selectedBackupId) : -1
											const canPrev = !backupsLoading && idx > 0
											const canNext = !backupsLoading && idx >= 0 && idx < backupsForTimeline.length - 1
											return (
												<>
													<button
														className='inline-flex h-8 items-center justify-center rounded-full bg-white/10 px-3 text-white shadow-[inset_0.5px_0.5px_1px_0px_#FFFFFF3D,inset_-0.5px_-0.5px_1px_0px_#FFFFFF1F] hover:bg-white/20 disabled:opacity-40'
														disabled={isSwitching || isRestoring || !canPrev}
														onClick={() => {
															if (!canPrev) return
															const prev = backupsForTimeline[idx - 1]
															if (prev) selectSnapshot(prev.id)
														}}
													>
														<ChevronLeftIcon className='size-4' />
													</button>
													<button
														className='inline-flex h-8 items-center justify-center rounded-full bg-white/10 px-3 text-white shadow-[inset_0.5px_0.5px_1px_0px_#FFFFFF3D,inset_-0.5px_-0.5px_1px_0px_#FFFFFF1F] hover:bg-white/20 disabled:opacity-40'
														disabled={isSwitching || isRestoring || !canNext}
														onClick={() => {
															if (!canNext) return
															const next = backupsForTimeline[idx + 1]
															if (next) selectSnapshot(next.id)
														}}
													>
														<ChevronRightIcon className='size-4' />
													</button>
												</>
											)
										})()}
									</div>
								</div>
							</div>
						</div>
						<DialogCloseButton surface='immersive' />
					</DialogPrimitive.Content>
				</DialogPrimitive.Portal>
			</Dialog>

			<RestoreProgressDialog
				open={restoreModalOpen}
				phase={restorePhase}
				onDismiss={() => setRestoreModalOpen(false)}
			/>
		</TooltipProvider>
	)
}
