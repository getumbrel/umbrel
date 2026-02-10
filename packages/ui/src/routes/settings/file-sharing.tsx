import {PlusCircle} from 'lucide-react'
import {AnimatePresence, motion} from 'motion/react'
import {useEffect, useRef, useState} from 'react'

import {Button} from '@/components/ui/button'
import {Dialog, DialogHeader, DialogScrollableContent, DialogTitle} from '@/components/ui/dialog'
import {Drawer, DrawerContent, DrawerHeader, DrawerScroller, DrawerTitle} from '@/components/ui/drawer'
import {listClass} from '@/components/ui/list'
import {Switch} from '@/components/ui/switch'
import {HomeIcon} from '@/features/files/assets/home-icon'
import {PlatformInstructions} from '@/features/files/components/dialogs/share-info-dialog/platform-instructions'
import {
	Platform,
	platforms,
	PlatformSelector,
} from '@/features/files/components/dialogs/share-info-dialog/platform-selector'
import {MiniBrowser} from '@/features/files/components/mini-browser'
import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {FolderIcon} from '@/features/files/components/shared/file-item-icon/folder-icon'
import {HOME_PATH} from '@/features/files/constants'
import {useHomeDirectoryName} from '@/features/files/hooks/use-home-directory-name'
import {useShares} from '@/features/files/hooks/use-shares'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {useSettingsDialogProps} from '@/routes/settings/_components/shared'
import {t} from '@/utils/i18n'
import {tw} from '@/utils/tw'

export default function FileSharingDrawerOrDialog() {
	const title = t('settings.file-sharing')
	const dialogProps = useSettingsDialogProps()
	const isMobile = useIsMobile()
	const homeDirectoryName = useHomeDirectoryName()

	const {
		shares,
		isLoadingShares,
		isHomeShared,
		sharePassword,
		isLoadingSharesPassword,
		addShare,
		removeShare,
		isAddingShare,
		isRemovingShare,
	} = useShares()

	const isEnabled = (shares?.length ?? 0) > 0
	const isBusy = isAddingShare || isRemovingShare
	const isLoading = isLoadingShares || isBusy

	const [selectedPlatform, setSelectedPlatform] = useState<Platform>(platforms[0])
	const [isAddFolderOpen, setAddFolderOpen] = useState(false)

	// Stable-ordered list of all folders seen during this dialog session.
	// Seeded with initial shares on first load, then updated on toggle-off and add.
	// Items stay in their original position even when toggled off.
	const [seenFolders, setSeenFolders] = useState<{name: string; path: string}[]>([])
	const seededRef = useRef(false)

	const homeShared = isHomeShared() ?? false

	// Individual shares (non-Home)
	const activeIndividualShares = shares?.filter((share) => share.path !== HOME_PATH) ?? []
	const activePaths = new Set(activeIndividualShares.map((s) => s.path))

	// Seed seenFolders with initial active shares once data loads
	useEffect(() => {
		if (!seededRef.current && !isLoadingShares && activeIndividualShares.length > 0) {
			seededRef.current = true
			setSeenFolders(activeIndividualShares.map((s) => ({name: s.name, path: s.path})))
		}
	}, [isLoadingShares, activeIndividualShares])

	const seenPaths = new Set(seenFolders.map((f) => f.path))

	// Build a stable-ordered list: seen folders first (preserves order),
	// then append any new active shares not yet tracked (e.g. just added via MiniBrowser).
	const individualShares = [
		...seenFolders.map((f) => ({name: f.name, path: f.path, isShared: activePaths.has(f.path)})),
		...activeIndividualShares
			.filter((s) => !seenPaths.has(s.path))
			.map((s) => ({name: s.name, path: s.path, isShared: true})),
	]

	// Whether any folders were toggled off during this session
	const hasRecentlyRemoved = seenFolders.some((f) => !activePaths.has(f.path))

	// Show the first-run choice screen when nothing is shared and nothing was recently removed
	const showChoiceScreen = !isEnabled && !hasRecentlyRemoved && !isLoadingShares

	// Derive name/sharename for platform instructions from the primary share
	const primaryShare = shares?.find((s) => s.path === HOME_PATH) ?? shares?.[0]
	const primaryName = primaryShare?.name ?? homeDirectoryName
	const primarySharename = primaryShare?.sharename

	// Home toggle handler
	const handleHomeToggle = async (checked: boolean) => {
		if (checked) {
			await addShare({path: HOME_PATH})
		} else {
			await removeShare({path: HOME_PATH})
		}
	}

	// Individual share toggle handler
	const handleShareToggle = async (path: string, name: string, checked: boolean) => {
		if (checked) {
			await addShare({path})
		} else {
			// Track in seenFolders so it stays visible at the same position
			setSeenFolders((prev) => (prev.some((f) => f.path === path) ? prev : [...prev, {name, path}]))
			await removeShare({path})
		}
	}

	const smbUrl =
		selectedPlatform.id === 'windows' ? `\\\\${window.location.hostname}` : `smb://${window.location.hostname}/`
	const username = 'umbrel'
	const password = isLoadingSharesPassword ? '...' : sharePassword || ''

	// --- First-run choice screen ---
	const choiceScreen = (
		<div className='flex flex-col gap-y-4'>
			<p className='px-1 text-13 -tracking-2 text-white/50'>{t('settings.file-sharing.choice-subtitle')}</p>
			<h4 className='px-1 text-14 font-semibold -tracking-2'>{t('settings.file-sharing.choice-heading')}</h4>
			<div className='grid grid-cols-2 gap-3'>
				<button
					className='flex flex-col items-center gap-3 rounded-12 bg-white/6 px-4 py-6 text-center transition-colors hover:bg-white/10 active:bg-white/8'
					onClick={() => addShare({path: HOME_PATH})}
					disabled={isBusy}
				>
					<HomeIcon className='h-10 w-10' />
					<div>
						<h4 className='text-13 leading-tight font-semibold md:text-14'>
							{t('settings.file-sharing.choice-entire-title')}
						</h4>
						<p className='mt-1 text-12 leading-tight text-white/40'>
							{t('settings.file-sharing.choice-entire-description')}
						</p>
					</div>
				</button>
				<button
					className='flex flex-col items-center gap-3 rounded-12 bg-white/6 px-4 py-6 text-center transition-colors hover:bg-white/10 active:bg-white/8'
					onClick={() => setAddFolderOpen(true)}
					disabled={isBusy}
				>
					<FolderIcon className='h-10 w-10' />
					<div>
						<h4 className='text-13 leading-tight font-semibold md:text-14'>
							{t('settings.file-sharing.choice-specific-title')}
						</h4>
						<p className='mt-1 text-12 leading-tight text-white/40'>
							{t('settings.file-sharing.choice-specific-description')}
						</p>
					</div>
				</button>
			</div>

			{/* MiniBrowser (shared with the active state below) */}
			<MiniBrowser
				open={isAddFolderOpen}
				onOpenChange={setAddFolderOpen}
				rootPath={HOME_PATH}
				onOpenPath={HOME_PATH}
				preselectOnOpen={false}
				title={t('settings.file-sharing.add-folder-title')}
				selectionMode='folders'
				disabledPaths={shares?.map((s) => s.path)}
				onSelect={(path) => {
					addShare({path})
					setAddFolderOpen(false)
				}}
			/>
		</div>
	)

	// --- Active sharing screen ---
	const activeScreen = (
		<div className='flex flex-col gap-y-6'>
			{/* Share entire Umbrel */}
			<div className={listClass}>
				<label className={listItemClass}>
					<FileItemIcon
						item={{name: 'Home', path: HOME_PATH, type: 'directory', modified: 0, size: 0, operations: []}}
						className='h-8 w-8 shrink-0'
					/>
					<div className='min-w-0 flex-1'>
						<h4 className='text-14 leading-tight font-medium'>{t('settings.file-sharing.share-entire-home-dir')}</h4>
						<p className='mt-[1px] text-12 leading-tight text-white/40'>
							{t('settings.file-sharing.share-entire-home-dir-description', {homeDirectoryName})}
						</p>
					</div>
					<Switch
						checked={homeShared}
						onCheckedChange={handleHomeToggle}
						disabled={isLoading}
						className={isBusy ? 'umbrel-pulse' : undefined}
					/>
				</label>
			</div>

			{/* Individual shared folders — hidden when home is shared and no individual shares */}
			{!(homeShared && activeIndividualShares.length === 0 && !hasRecentlyRemoved) && (
				<div className='flex flex-col gap-y-2'>
					<div className='flex items-center justify-between px-1'>
						<h4 className='text-13 font-medium -tracking-2 text-white/60'>
							{t('settings.file-sharing.shared-folders')}
						</h4>
						<Button size='sm' onClick={() => setAddFolderOpen(true)}>
							{t('settings.file-sharing.add-folder')}
							<PlusCircle className='h-3 w-3' />
						</Button>
					</div>
					{homeShared && (
						<p className='px-1 text-11 leading-tight -tracking-2 text-white/30'>
							{t('settings.file-sharing.home-shared-note', {homeDirectoryName})}
						</p>
					)}
					{individualShares.length > 0 && (
						<div className={listClass}>
							<AnimatePresence initial={false}>
								{individualShares.map((share) => (
									<motion.label
										key={share.path}
										className={listItemClass}
										initial={{opacity: 0, height: 0}}
										animate={{opacity: 1, height: 'auto'}}
										exit={{opacity: 0, height: 0}}
										transition={{duration: 0.2}}
									>
										<FileItemIcon
											item={{
												name: share.name,
												path: share.path,
												type: 'directory',
												modified: 0,
												size: 0,
												operations: [],
											}}
											className='h-7 w-7 shrink-0'
										/>
										<span className='min-w-0 flex-1 truncate text-14 font-medium'>{share.name}</span>
										<Switch
											checked={share.isShared}
											onCheckedChange={(checked) => handleShareToggle(share.path, share.name, checked)}
											disabled={isLoading}
										/>
									</motion.label>
								))}
							</AnimatePresence>
						</div>
					)}
				</div>
			)}

			{/* MiniBrowser for adding shared folders */}
			<MiniBrowser
				open={isAddFolderOpen}
				onOpenChange={setAddFolderOpen}
				rootPath={HOME_PATH}
				onOpenPath={HOME_PATH}
				preselectOnOpen={false}
				title={t('settings.file-sharing.add-folder-title')}
				selectionMode='folders'
				disabledPaths={shares?.map((s) => s.path)}
				onSelect={(path) => {
					addShare({path})
					setAddFolderOpen(false)
				}}
			/>

			{/* Connection instructions */}
			<AnimatePresence>
				{isEnabled && (
					<motion.div
						initial={{height: 0, opacity: 0}}
						animate={{height: 'auto', opacity: 1}}
						exit={{height: 0, opacity: 0}}
						transition={{duration: 0.3}}
						className='overflow-hidden'
					>
						{/* Gradient divider */}
						<div
							className='my-2 h-[1px] w-full'
							style={{
								background:
									'radial-gradient(50% 50% at 50% 50%, rgba(255, 255, 255, 0.5) 0%, rgba(255, 255, 255, 0) 100%)',
							}}
						/>
						<div className='flex flex-col gap-4 pt-2'>
							<PlatformSelector selectedPlatform={selectedPlatform} onPlatformChange={setSelectedPlatform} />
							<PlatformInstructions
								platform={selectedPlatform}
								smbUrl={smbUrl}
								username={username}
								password={password}
								name={primaryName}
								sharename={primarySharename}
							/>
						</div>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	)

	const content = showChoiceScreen ? choiceScreen : activeScreen

	if (isMobile) {
		return (
			<Drawer {...dialogProps}>
				<DrawerContent fullHeight>
					<DrawerHeader>
						<DrawerTitle>{title}</DrawerTitle>
					</DrawerHeader>
					<DrawerScroller>{content}</DrawerScroller>
				</DrawerContent>
			</Drawer>
		)
	}

	return (
		<Dialog {...dialogProps}>
			<DialogScrollableContent>
				<div className='space-y-3 px-5 py-6'>
					<DialogHeader>
						<DialogTitle>{title}</DialogTitle>
					</DialogHeader>
					{content}
				</div>
			</DialogScrollableContent>
		</Dialog>
	)
}

const listItemClass = tw`flex items-center gap-3 px-3 py-2.5 text-14 font-medium -tracking-3`
