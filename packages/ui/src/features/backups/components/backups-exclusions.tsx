// This is the "Exclude from Backups" section of the Backups Configure Wizard
// It renders and allows the selection/deselection of files, folders, and apps to be excluded from backups

import {ChevronDown, MinusCircle, PlusCircle} from 'lucide-react'
import {matchSorter} from 'match-sorter'
import {useEffect, useMemo, useRef, useState} from 'react'

import {AppIcon} from '@/components/app-icon'
import {useAppsAutoExcludedPaths} from '@/features/backups/hooks/use-apps-auto-excluded-paths'
import {useAppsBackupIgnoredSummary} from '@/features/backups/hooks/use-apps-backup-ignore'
import {useBackupIgnoredPaths} from '@/features/backups/hooks/use-backup-ignored-paths'
import {formatAppPathForDisplay} from '@/features/backups/utils/filepath-helpers'
import {MiniBrowser} from '@/features/files/components/mini-browser'
import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {useListDirectory} from '@/features/files/hooks/use-list-directory'
import type {FileSystemItem} from '@/features/files/types'
import {useApps} from '@/providers/apps'
import {Button} from '@/shadcn-components/ui/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/shadcn-components/ui/dropdown-menu'
import {Input} from '@/shadcn-components/ui/input'
import {ScrollArea} from '@/shadcn-components/ui/scroll-area'
import {t} from '@/utils/i18n'

// MAIN COMPONENT
export function BackupsExclusions({showTitle = false}: {showTitle?: boolean}) {
	const {filteredIgnoredPaths, addIgnoredPath, removeIgnoredPath} = useBackupIgnoredPaths()

	const [isAddFolderOpen, setAddFolderOpen] = useState(false)

	// Apps
	const {userApps = [], isLoading: isLoadingApps} = useApps()
	const {
		isIgnoredByAppId,
		excludedAppsCount,
		ignore,
		unignore,
		isLoading: isIgnoredLoading,
	} = useAppsBackupIgnoredSummary()
	const {pathsByAppId, autoExcludedAppsCount, isLoading: isAutoExcludedLoading} = useAppsAutoExcludedPaths()

	const [appPickerOpen, setAppPickerOpen] = useState(false)
	const [appQuery, setAppQuery] = useState('')

	const appQueryInputRef = useRef<HTMLInputElement>(null)

	useEffect(() => {
		if (!appPickerOpen) return
		setTimeout(() => {
			appQueryInputRef.current?.focus()
			appQueryInputRef.current?.select()
		}, 0)
	}, [appPickerOpen])

	return (
		<div className='space-y-3'>
			{showTitle && <span className='text-13 font-medium text-white/90'>{t('backups.exclude-from-backups')}</span>}

			{/* Folders */}
			<div className='space-y-2'>
				<div className='flex items-center justify-between'>
					<div className='text-13 text-white/60'>{t('backups-exclusions.files-and-folders')}</div>
					<Button size='sm' onClick={() => setAddFolderOpen(true)}>
						{t('backups-exclusions.add')}
						<PlusCircle className='h-3 w-3' />
					</Button>
				</div>
				<div className='divide-y divide-white/6 rounded-12 bg-white/5'>
					{filteredIgnoredPaths.length === 0 ? (
						<div className='p-4 text-sm text-white/50'>{t('backups-exclusions.no-excluded-files-or-folders')}</div>
					) : (
						<>
							{filteredIgnoredPaths.map((p: string) => (
								<FilePathRow
									key={p}
									path={p}
									rightSlot={
										<span
											role='button'
											tabIndex={0}
											onClick={() => removeIgnoredPath(p)}
											onKeyDown={(e) => {
												if (e.key === 'Enter' || e.key === ' ') {
													e.preventDefault()
													removeIgnoredPath(p)
												}
											}}
											aria-label={t('backups-exclusions.stop-excluding')}
											className='inline-flex h-6 w-6 cursor-pointer items-center justify-center text-[#F45A5A] hover:text-[#F45A5A]/90'
										>
											<MinusCircle className='h-4 w-4' />
										</span>
									}
								/>
							))}
						</>
					)}
				</div>
			</div>

			{/* Apps */}
			<div className='space-y-2'>
				<div className='flex items-center justify-between'>
					<div className='text-13 text-white/60'>{t('backups-exclusions.excluded-apps')}</div>
					<DropdownMenu
						open={appPickerOpen}
						onOpenChange={(o) => {
							setAppPickerOpen(o)
							if (!o) setAppQuery('')
						}}
					>
						<DropdownMenuTrigger asChild>
							<Button size='sm' className='inline-flex items-center gap-1'>
								{t('backups-exclusions.add')}
								<PlusCircle className='h-3 w-3' />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align='end' className='flex max-h-72 min-w-64 flex-col gap-3'>
							{isLoadingApps && <div className='p-2 text-sm text-white/50'>{t('loading')}</div>}
							{!isLoadingApps && (
								<>
									<Input
										value={appQuery}
										className='shrink-0'
										onChange={(e) => setAppQuery(e.target.value)}
										onKeyDown={(e) => {
											e.stopPropagation()
											if (e.key === 'Escape') setAppPickerOpen(false)
										}}
										sizeVariant={'short-square'}
										placeholder={t('app-picker.search')}
										ref={appQueryInputRef}
									/>
									{(() => {
										const rawApps = userApps || []
										const results = matchSorter(rawApps, appQuery, {
											keys: ['name', 'id'],
											threshold: matchSorter.rankings.WORD_STARTS_WITH,
										})
										if (results.length === 0) {
											return <div className='px-2 text-14 text-white/50'>{t('no-results-found')}</div>
										}
										return (
											<ScrollArea className='relative -mx-2.5 flex h-full flex-col px-2.5'>
												{results.map((app) => (
													<DropdownMenuItem
														key={app.id}
														onSelect={() => {
															ignore(app.id)
															setAppPickerOpen(false)
														}}
														className='flex items-center gap-2'
													>
														<AppIcon size={20} src={app.icon} className='rounded-4' />
														<span className='truncate'>{app.name || app.id}</span>
													</DropdownMenuItem>
												))}
											</ScrollArea>
										)
									})()}
								</>
							)}
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
				{/* Existing app exclusions list */}
				<div className='divide-y divide-white/6 rounded-12 bg-white/5'>
					{(isLoadingApps || isIgnoredLoading || isAutoExcludedLoading) && (
						<div className='p-3 text-sm text-white/50'>{t('loading')}</div>
					)}
					{!isLoadingApps &&
					!isIgnoredLoading &&
					!isAutoExcludedLoading &&
					excludedAppsCount === 0 &&
					autoExcludedAppsCount === 0 ? (
						<div className='p-4 text-sm text-white/50'>{t('backups-exclusions.no-excluded-apps')}</div>
					) : (
						!isLoadingApps &&
						(userApps || []).map((app) => (
							<AppRow
								key={app.id}
								app={app}
								onUnignore={(appId) => unignore(appId)}
								onIgnore={(appId) => ignore(appId)}
								paths={pathsByAppId.get(app.id) || []}
								isIgnored={!!isIgnoredByAppId.get(app.id)}
							/>
						))
					)}
				</div>
			</div>

			{/* MiniBrowser for adding excluded files and folders */}
			<MiniBrowser
				open={isAddFolderOpen}
				onOpenChange={setAddFolderOpen}
				rootPath={'/Home'}
				onOpenPath={'/Home'}
				preselectOnOpen={false}
				title={t('backups-exclusions.select-item-to-exclude')}
				// we allow selecting both files and folders
				selectionMode='files-and-folders'
				onSelect={(p) => {
					addIgnoredPath(p)
					setAddFolderOpen(false)
				}}
			/>
		</div>
	)
}

// SUB-COMPONENTS

function useFileItemForPath(path: string) {
	const name = useMemo(() => path.split('/').filter(Boolean).pop() || '', [path])
	const parent = useMemo(() => {
		const parts = path.split('/').filter(Boolean)
		return '/' + parts.slice(0, -1).join('/')
	}, [path])
	const {listing} = useListDirectory(parent || '/')
	const found = (listing?.items || []).find((f: any) => f?.name === name) as FileSystemItem | undefined
	return found
}

function FilePathRow({path, rightSlot}: {path: string; rightSlot?: React.ReactNode}) {
	const found = useFileItemForPath(path)
	const name = useMemo(() => path.split('/').filter(Boolean).pop() || path, [path])
	const item: FileSystemItem = found || {
		path,
		name,
		type: '',
		modified: 0,
		size: 0,
		thumbnail: undefined,
		operations: [],
	}
	const displayPath = path.startsWith('/Home/') ? path.slice('/Home/'.length) : path
	return (
		<div className='flex items-center justify-between p-3 text-sm'>
			<div className='flex min-w-0 flex-1 items-center gap-2'>
				<FileItemIcon item={item} className='size-6' />
				<span dir='ltr' className='w-0 flex-1 truncate text-left text-13' title={path}>
					{displayPath}
				</span>
			</div>
			{rightSlot ? <div className='shrink-0'>{rightSlot}</div> : null}
		</div>
	)
}

function AppRow({
	app,
	onUnignore,
	onIgnore,
	paths,
	isIgnored,
}: {
	app: {id: string; name?: string; icon?: string}
	onUnignore: (appId: string) => void
	onIgnore: (appId: string) => void
	paths: string[]
	isIgnored: boolean
}) {
	const [open, setOpen] = useState(false)
	const hasDefaultIgnores = (paths || []).length > 0

	if (!isIgnored && !hasDefaultIgnores) return null

	return (
		<div className='p-3 text-sm'>
			<div className='flex items-center justify-between gap-2'>
				<div className='flex min-w-0 items-center gap-2'>
					<AppIcon size={26} src={app.icon} className='rounded-md' />
					<span className='truncate text-13' title={app.name || app.id}>
						{app.name || app.id}
					</span>
				</div>
				<div className='flex items-center gap-2'>
					{!isIgnored && hasDefaultIgnores && (
						<button
							onClick={() => setOpen((v) => !v)}
							className='flex items-center gap-1 rounded-md bg-white/10 px-2 py-0.5 text-12 text-white/70 hover:text-white'
							type='button'
						>
							{t('backups-exclusions.auto-excluded')} ({paths.length})
							<ChevronDown className={`size-3 transition-transform ${open ? 'rotate-180' : ''}`} />
						</button>
					)}
					{isIgnored && (
						<span
							role='button'
							tabIndex={0}
							onClick={() => onUnignore(app.id)}
							onKeyDown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault()
									onUnignore(app.id)
								}
							}}
							aria-label={t('backups-exclusions.stop-excluding')}
							className='inline-flex size-6 cursor-pointer items-center justify-center text-[#F45A5A] hover:text-[#F45A5A]/90'
						>
							<MinusCircle className='size-4' />
						</span>
					)}
				</div>
			</div>
			{!isIgnored && open && hasDefaultIgnores && (
				<div className='mt-2 space-y-1 rounded-md bg-white/5 p-2'>
					<div className='text-12 text-white/60'>{t('backups-exclusions.app-paths-explanation')}</div>
					<div className='text-12 text-white/60'>{t('backups-exclusions.app-paths-cannot-be-modified')}</div>
					{paths.map((p: string) => (
						<FilePathRow key={p} path={formatAppPathForDisplay(p)} />
					))}
					<div className='pt-1'>
						<Button
							variant='destructive'
							size='sm'
							onClick={() => {
								onIgnore(app.id)
								setOpen(false)
							}}
						>
							{t('backups-exclusions.exclude-entire-app')}
						</Button>
					</div>
				</div>
			)}
		</div>
	)
}
