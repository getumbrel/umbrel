import {AnimatePresence, motion} from 'framer-motion'
import {useEffect, useState} from 'react'
import {useSearchParams} from 'react-router-dom'

import {FadeScroller} from '@/components/fade-scroller'
import {PlatformInstructions} from '@/features/files/components/dialogs/share-info-dialog/platform-instructions'
import {
	Platform,
	platforms,
	PlatformSelector,
} from '@/features/files/components/dialogs/share-info-dialog/platform-selector'
import {ShareToggle} from '@/features/files/components/dialogs/share-info-dialog/share-toggle'
import {HOME_PATH} from '@/features/files/constants'
import {useHomeDirectoryName} from '@/features/files/hooks/use-home-directory-name'
import {useShares} from '@/features/files/hooks/use-shares'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {Button} from '@/shadcn-components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/shadcn-components/ui/dialog'
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerHeader,
	DrawerScroller,
	DrawerTitle,
} from '@/shadcn-components/ui/drawer'
import {useDialogOpenProps} from '@/utils/dialog'
import {t} from '@/utils/i18n'

export default function ShareInfoDialog() {
	const isMobile = useIsMobile()
	const homeDirectoryName = useHomeDirectoryName()
	const [searchParams, setSearchParams] = useSearchParams()
	const name = searchParams.get('files-share-info-name') || ''
	const path = searchParams.get('files-share-info-path') || ''
	const dialogProps = useDialogOpenProps('files-share-info')
	const [firstEverSharePrompt, setShowFirstEverSharePrompt] = useState(false)
	const [hasHadShares, setHasHadShares] = useState(false)

	const {
		shares,
		sharePassword,
		addShare,
		removeShare,
		isPathShared,
		isAddingShare,
		isRemovingShare,
		isLoadingSharesPassword,
	} = useShares()

	const [selectedPlatform, setSelectedPlatform] = useState<Platform>(platforms[0])

	const isShared = isPathShared(path) ?? false
	const isSharingHome = path === HOME_PATH

	useEffect(() => {
		// If we see any shares, remember that we've had shares before
		// because we don't want to show the first ever share prompt if the user just toggled off the last share
		if (shares && shares.length > 0) {
			setHasHadShares(true)
		}
	}, [shares])

	// Show the first ever share prompt if:
	// 1. User doesn't have any shares
	// 2. Didn't just toggle off the last
	// 3. Is not trying to share the home directory
	useEffect(() => {
		if (shares && shares.length === 0 && !hasHadShares && path !== HOME_PATH) {
			setShowFirstEverSharePrompt(true)
		}

		return () => {
			setShowFirstEverSharePrompt(false)
		}
	}, [shares, path, hasHadShares])

	const handleShareToggle = (checked: boolean) => {
		if (checked) {
			addShare({path})
		} else {
			removeShare({path})
		}
	}

	let title = isSharingHome ? t('files-share.home-title', {homeDirectoryName}) : t('files-share.regular-title')
	let description = isSharingHome
		? t('files-share.home-description', {homeDirectoryName})
		: t('files-share.regular-description')

	if (firstEverSharePrompt) {
		title = t('files-share.first-prompt-title')
		description = t('files-share.first-prompt-description', {folderName: name, homeDirectoryName})
	}

	const smbUrl =
		selectedPlatform.id === 'windows' ? `\\\\${window.location.hostname}` : `smb://${window.location.hostname}/`
	const username = 'umbrel'
	const password = isLoadingSharesPassword ? '...' : sharePassword || ''

	const content = (
		<div className='space-y-6'>
			{/* First ever share prompt buttons */}
			{firstEverSharePrompt ? (
				<div className='flex gap-3'>
					<Button
						variant='primary'
						onClick={() => {
							setShowFirstEverSharePrompt(false)
						}}
					>
						{t('files-share.first-prompt-share-folder', {folderName: name})}
					</Button>
					<Button
						variant='default'
						onClick={() => {
							setSearchParams({
								dialog: 'files-share-info',
								'files-share-info-name': homeDirectoryName,
								'files-share-info-path': HOME_PATH,
							})
						}}
					>
						{t('files-share.first-prompt-share-home', {homeDirectoryName})}
					</Button>
				</div>
			) : (
				// Share toggle and instructions
				<div className='flex flex-col gap-4'>
					<ShareToggle
						name={name}
						isShared={isShared}
						isLoading={isAddingShare || isRemovingShare}
						onToggle={handleShareToggle}
					/>
					{isShared && (
						<AnimatePresence>
							{isShared && (
								<motion.div
									initial={{height: 0, opacity: 0}}
									animate={{height: 'auto', opacity: 1}}
									exit={{height: 0, opacity: 0}}
									transition={{duration: 0.3}}
									className='overflow-hidden'
								>
									<div
										className='my-4 h-[1px] w-full'
										style={{
											background:
												'radial-gradient(50% 50% at 50% 50%, rgba(255, 255, 255, 0.5) 0%, rgba(255, 255, 255, 0) 100%)',
										}}
									/>
									<div className='flex flex-col gap-4'>
										<PlatformSelector selectedPlatform={selectedPlatform} onPlatformChange={setSelectedPlatform} />
										<PlatformInstructions
											platform={selectedPlatform}
											smbUrl={smbUrl}
											username={username}
											password={password}
											name={name}
										/>
									</div>
								</motion.div>
							)}
						</AnimatePresence>
					)}
				</div>
			)}
		</div>
	)

	if (isMobile) {
		return (
			<Drawer {...dialogProps}>
				<DrawerContent fullHeight>
					<DrawerHeader>
						<DrawerTitle>{title}</DrawerTitle>
						<DrawerDescription>{description}</DrawerDescription>
					</DrawerHeader>
					<DrawerScroller>{content}</DrawerScroller>
				</DrawerContent>
			</Drawer>
		)
	}

	return (
		<Dialog {...dialogProps}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				<FadeScroller direction='y' className='umbrel-hide-scrollbar flex-1 overflow-y-auto'>
					{content}
				</FadeScroller>
				<DialogFooter>
					{!firstEverSharePrompt && (
						<Button variant='default' onClick={dialogProps.onOpenChange.bind(null, false)}>
							<span>{t('done')}</span>
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
