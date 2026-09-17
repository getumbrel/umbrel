import {AnimatePresence, motion, useReducedMotion} from 'motion/react'
import {useCallback, useEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'

import {AnimatedHeight} from '@/components/ui/animated-height'
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerHeader,
	DrawerScroller,
	DrawerTitle,
} from '@/components/ui/drawer'
import {toast} from '@/components/ui/toast'
import {MiniBrowser} from '@/features/files/components/mini-browser'
import {CLOUD_PROVIDER_LOGOS, EXTERNAL_STORAGE_PATH, NETWORK_STORAGE_PATH} from '@/features/files/constants'
import {
	useCloudAccounts,
	useCloudConnect,
	useCloudProviders,
	type CloudAccount,
	type CloudLocations,
	type CloudProvider,
	type CloudSyncMode,
	type CloudSyncRemote,
} from '@/features/files/hooks/use-cloud'
import {useHomePath, useIsMember} from '@/features/files/hooks/use-home-path'
import {useMemberShares} from '@/features/files/hooks/use-member-shares'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import type {FileSystemItem} from '@/features/files/types'
import {CLOUD_WEBDAV_FLAVORS, isValidCloudDestination, type CloudWebDavFlavorId} from '@/features/files/utils/cloud'
import {getFilesErrorMessage} from '@/features/files/utils/error-messages'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {useQueryParams} from '@/hooks/use-query-params'
import {cn} from '@/lib/utils'
import {trpcReact, type RouterError} from '@/trpc/trpc'
import {useDialogOpenProps} from '@/utils/dialog'

import {CloudFolderStep, type CloudFolderState} from './cloud-folder-step'
import {ConnectStep, type ConnectedResult} from './connect-step'
import {DestinationStep} from './destination-step'
import {SourceStep} from './source-step'

enum Step {
	Source = 0,
	Connect = 1,
	CloudFolder = 2,
	Destination = 3,
}

// Synthetic root for the cloud folder picker. Entries below it are cloud remotes,
// not local filesystem paths.
const CLOUD_BROWSE_ROOT = '/cloud'

export default function CloudAddDialog() {
	const {t} = useTranslation()
	const isMobile = useIsMobile()
	const dialogProps = useDialogOpenProps('files-cloud-add')
	const {params} = useQueryParams()
	const {navigateToDirectory} = useNavigate()
	const utils = trpcReact.useUtils()
	const homePath = useHomePath()
	const isMember = useIsMember()
	const {sharedWithMe} = useMemberShares()
	const destinationRootPaths = [
		homePath,
		...(!isMember || sharedWithMe?.shares.some(({path}) => path === EXTERNAL_STORAGE_PATH)
			? [EXTERNAL_STORAGE_PATH]
			: []),
		...(!isMember || sharedWithMe?.shares.some(({path}) => path === NETWORK_STORAGE_PATH)
			? [NETWORK_STORAGE_PATH]
			: []),
	]

	const {data: providers, isLoading: isLoadingProviders} = useCloudProviders({enabled: dialogProps.open})
	const {data: accounts, isLoading: isLoadingAccounts} = useCloudAccounts({enabled: dialogProps.open})
	const {fetchLocations, browseRemote, createSync} = useCloudConnect()
	const createDirectory = trpcReact.files.createDirectory.useMutation()

	// Wizard state lives here (not inside DialogContent) so it survives the wizard
	// dialog hiding behind the folder pickers.
	const [step, setStep] = useState<Step>(Step.Source)
	// The source step opens as the constellation pitch for a first-run user and
	// as the picker for everyone else; null until accounts resolve the choice
	const [sourceView, setSourceView] = useState<'pitch' | 'picker' | null>(null)
	const [provider, setProvider] = useState<CloudProvider | null>(null)
	const [webdavFlavor, setWebdavFlavor] = useState<CloudWebDavFlavorId | null>(null)
	const [accountId, setAccountId] = useState<string | null>(null)
	const [reauthing, setReauthing] = useState(false)
	// Whether the session traveled through a picker tile (and the connect step),
	// which is what earns the diagram its shared-element flight. Entering via an
	// existing account skips the tile, so nothing should appear to fly in.
	const [cameFromConnect, setCameFromConnect] = useState(false)
	const [locations, setLocations] = useState<CloudLocations | null>(null)
	const [folderState, setFolderState] = useState<CloudFolderState>('loading')
	const [remote, setRemote] = useState<{ref: CloudSyncRemote; name: string} | null>(null)
	const [truncated, setTruncated] = useState(false)
	const [cloudPickerOpen, setCloudPickerOpen] = useState(false)
	// The destination as a full path: auto-proposed under /Home (created at
	// start) or an existing empty folder the user picked in the browser
	const [destinationPath, setDestinationPath] = useState<string | null>(null)
	const [destinationPicked, setDestinationPicked] = useState(false)
	// Whether the whole cloud is being downloaded rather than one folder; the
	// destination proposal and the mode copy phrase themselves accordingly
	const [wholeCloud, setWholeCloud] = useState(false)
	const [isProposing, setIsProposing] = useState(false)
	const [mode, setMode] = useState<CloudSyncMode>('auto')
	const [destinationPickerOpen, setDestinationPickerOpen] = useState(false)
	const [createBusy, setCreateBusy] = useState(false)
	const [isStarting, setIsStarting] = useState(false)
	const remoteRefMap = useRef(new Map<string, {ref: CloudSyncRemote; name: string}>())
	const initializedFromParamsRef = useRef(false)
	const locationsRequestRef = useRef(0)
	const proposalRequestRef = useRef(0)
	const invalidateLocationRequests = useCallback(() => {
		locationsRequestRef.current += 1
	}, [])

	const prefilledDestination = params.get('files-cloud-add-destination')

	// Reset on every open
	useEffect(() => {
		invalidateLocationRequests()
		if (!dialogProps.open) return
		setStep(Step.Source)
		setSourceView(null)
		setProvider(null)
		setWebdavFlavor(null)
		setAccountId(null)
		setReauthing(false)
		setCameFromConnect(false)
		setLocations(null)
		setFolderState('loading')
		setRemote(null)
		setTruncated(false)
		setCloudPickerOpen(false)
		setDestinationPath(null)
		setDestinationPicked(false)
		setWholeCloud(false)
		setIsProposing(false)
		setMode('auto')
		setDestinationPickerOpen(false)
		setCreateBusy(false)
		setIsStarting(false)
		remoteRefMap.current.clear()
		initializedFromParamsRef.current = false
		proposalRequestRef.current++
	}, [dialogProps.open, invalidateLocationRequests])

	// The pitch is for the first run only: any existing account, or arriving from
	// a surface that already made the pitch, goes straight to the picker
	useEffect(() => {
		if (!dialogProps.open || sourceView !== null || !accounts) return
		const skipPitch = accounts.length > 0 || params.get('files-cloud-add-picker') !== null
		setSourceView(skipPitch ? 'picker' : 'pitch')
	}, [dialogProps.open, sourceView, accounts, params])

	const loadLocations = useCallback(
		async (forAccountId: string) => {
			const requestId = ++locationsRequestRef.current
			setFolderState('loading')
			try {
				const result = await fetchLocations(forAccountId)
				if (requestId !== locationsRequestRef.current) return
				setLocations(result)
				setTruncated(result.truncated)
				setFolderState('ready')
				// A single root gets the download-everything/choose-folder screen; with
				// several roots that choice is ambiguous, so go straight to browsing
				setCloudPickerOpen(result.locations.length > 1)
			} catch (error) {
				if (requestId !== locationsRequestRef.current) return
				const message = (error as RouterError).message ?? ''
				if (message.includes('[cloud-account-busy]')) setFolderState('busy')
				else if (message.includes('[cloud-account-auth-required]')) setFolderState('auth')
				else {
					setFolderState('error')
					toast.error(t('files-cloud-error.browse', {message: getFilesErrorMessage(message)}), {area: 'files'})
				}
			}
		},
		[fetchLocations, t],
	)

	const handleSelectAccount = (account: CloudAccount) => {
		const accountProvider = providers?.find(({id}) => id === account.provider)
		if (!accountProvider) return
		setProvider(accountProvider)
		// A flavored WebDAV account keeps its branding through every later step
		setWebdavFlavor(
			account.connection.kind === 'webdav' && account.connection.flavor !== 'webdav' ? account.connection.flavor : null,
		)
		setAccountId(account.id)
		setCameFromConnect(false)
		setLocations(null)
		setCloudPickerOpen(false)
		setDestinationPickerOpen(false)
		setRemote(null)
		remoteRefMap.current.clear()
		setStep(Step.CloudFolder)
		loadLocations(account.id)
	}

	// Entry via ?files-cloud-add-account=<id> starts at the cloud folder
	// step; with the -reauth flag (the notification and banner sign-in links) it
	// opens straight on the connect step to sign the account in again
	useEffect(() => {
		if (!dialogProps.open || initializedFromParamsRef.current) return
		const accountParam = params.get('files-cloud-add-account')
		if (!accountParam) {
			initializedFromParamsRef.current = true
			return
		}
		if (!accounts || !providers) return
		initializedFromParamsRef.current = true
		const account = accounts.find(({id}) => id === accountParam)
		if (!account) return
		if (params.get('files-cloud-add-reauth')) {
			startReauth(account)
		} else {
			handleSelectAccount(account)
		}
	}, [dialogProps.open, accounts, providers])

	// Drives the wizard straight to the connect step to sign an existing
	// account in again; used by the reauth deep link and the in-wizard
	// account manage dialog
	const startReauth = (account: CloudAccount) => {
		const accountProvider = providers?.find(({id}) => id === account.provider)
		if (!accountProvider) return
		invalidateLocationRequests()
		setProvider(accountProvider)
		// A flavored WebDAV account keeps its branding through reauthentication
		setWebdavFlavor(
			account.connection.kind === 'webdav' && account.connection.flavor !== 'webdav' ? account.connection.flavor : null,
		)
		setAccountId(account.id)
		setCameFromConnect(false)
		setLocations(null)
		setCloudPickerOpen(false)
		setDestinationPickerOpen(false)
		setRemote(null)
		remoteRefMap.current.clear()
		setReauthing(true)
		setStep(Step.Connect)
	}

	const handleConnected = (result: ConnectedResult) => {
		invalidateLocationRequests()
		// Reauthentication's whole job is done once the account is signed in
		// again: close the wizard rather than continue into folder selection
		if (reauthing) {
			handleDialogOpenChange(false)
			return
		}
		setAccountId(result.accountId)
		setCameFromConnect(true)
		setLocations(result.locations)
		setTruncated(result.locations.truncated)
		remoteRefMap.current.clear()
		setDestinationPickerOpen(false)
		setRemote(null)
		setFolderState('ready')
		setStep(Step.CloudFolder)
		setCloudPickerOpen(result.locations.locations.length > 1)
	}

	// Constructs the child RemoteRef for a browsed entry. Google Drive and OneDrive
	// pin folder ids; path-based providers only need the path.
	const childRemote = (parent: CloudSyncRemote, entry: {path: string; id?: string}): CloudSyncRemote => {
		if (provider?.id === 'google-drive' || provider?.id === 'onedrive') {
			return {...parent, path: entry.path, folderId: entry.id ?? ''}
		}
		return {...parent, path: entry.path}
	}

	const listCloudDirectory = useCallback(
		async (path: string): Promise<FileSystemItem[]> => {
			const toItem = (
				name: string,
				itemPath: string,
				type: 'directory' | 'application/octet-stream' = 'directory',
			): FileSystemItem => ({name, path: itemPath, type, size: 0, modified: 0, operations: []}) as FileSystemItem

			if (path === CLOUD_BROWSE_ROOT) {
				return (locations?.locations ?? []).map((location) => {
					const syntheticPath = `${CLOUD_BROWSE_ROOT}/${location.id}`
					remoteRefMap.current.set(syntheticPath, {ref: location.remote, name: location.displayName})
					return toItem(location.displayName, syntheticPath)
				})
			}

			const parent = remoteRefMap.current.get(path)
			if (!parent || !accountId) return []
			try {
				const result = await browseRemote(accountId, parent.ref)
				if (result.truncated) setTruncated(true)
				const seen = new Map<string, number>()
				return result.entries.map((entry) => {
					const nameCount = seen.get(entry.name) ?? 0
					seen.set(entry.name, nameCount + 1)
					const syntheticPath = `${path}/${nameCount === 0 ? entry.name : `${entry.name} (${nameCount + 1})`}`
					if (entry.type === 'directory') {
						remoteRefMap.current.set(syntheticPath, {ref: childRemote(parent.ref, entry), name: entry.name})
					}
					return toItem(
						entry.name,
						syntheticPath,
						entry.type === 'directory' ? 'directory' : 'application/octet-stream',
					)
				})
			} catch (error) {
				toast.error(t('files-cloud-error.browse', {message: getFilesErrorMessage((error as RouterError).message)}), {
					area: 'files',
				})
				return []
			}
		},
		[accountId, browseRemote, locations, t],
	)

	// How this session's cloud is named to the user. A Nextcloud/ownCloud flavor
	// keeps its own name through the whole wizard even though the account
	// underneath is plain webdav.
	const sourceName = webdavFlavor
		? (CLOUD_WEBDAV_FLAVORS.find(({id}) => id === webdavFlavor)?.displayName ?? '')
		: (provider?.displayName ?? '')
	const isPersonalOneDrive = provider?.id === 'onedrive' && locations?.locations[0]?.remote.driveType === 'personal'

	// Names already present in a destination parent. Best-effort: the check is
	// capped at 10k entries, and anything it misses is still caught server-side.
	const fetchTakenNames = useCallback(
		async (path: string) => {
			try {
				const result = await utils.client.files.list.query({path, limit: 10_000})
				return new Set(result.files.map(({name}) => name))
			} catch {
				return new Set<string>()
			}
		},
		[utils],
	)

	// A collision-free folder name under this account's Home: the base name, numbered only
	// when something already claims it
	const deconflict = (base: string, taken: Set<string>) => {
		let name = base
		let index = 2
		while (taken.has(name)) name = `${base} (${index++})`
		return name
	}

	// Proposes <account Home>/<name> for the download: "My {provider}" when downloading a
	// whole cloud, "{folder} (from {provider})" for a specific folder
	const proposeDestination = async (base: string) => {
		const requestId = ++proposalRequestRef.current
		setIsProposing(true)
		const taken = await fetchTakenNames(homePath)
		if (requestId !== proposalRequestRef.current) return
		setDestinationPath(`${homePath}/${deconflict(base, taken)}`)
		setIsProposing(false)
	}

	// Arrival at the destination step: everything is prefilled so the happy path
	// is read, not typed
	const startDestination = (picked: {ref: CloudSyncRemote; name: string}, isWholeCloud: boolean) => {
		setRemote(picked)
		setWholeCloud(isWholeCloud)
		setMode('auto')
		setCreateBusy(false)
		setCloudPickerOpen(false)
		setStep(Step.Destination)
		if (prefilledDestination) {
			setDestinationPath(prefilledDestination)
			setDestinationPicked(true)
			return
		}
		setDestinationPath(null)
		setDestinationPicked(false)
		proposeDestination(
			isWholeCloud
				? t('files-cloud.destination-default-root-name', {provider: sourceName})
				: t('files-cloud.destination-proposed-name', {name: picked.name, source: sourceName}),
		)
	}

	const handleCloudFolderPicked = (path: string) => {
		const picked = remoteRefMap.current.get(path)
		if (!picked) return
		// A top-level entry in the cloud browser is a provider location (My
		// Drive, a shared drive), which reads as downloading the whole cloud
		const isWholeCloud = path.split('/').filter(Boolean).length === 2
		startDestination(picked, isWholeCloud)
	}

	// Download the provider's sole root wholesale, same as picking it in the browser
	const handleDownloadAll = () => {
		const location = locations?.locations[0]
		if (!location) return
		startDestination({ref: location.remote, name: location.displayName}, true)
	}

	const handleStart = async () => {
		if (!accountId || !remote || !destinationPath) return
		setIsStarting(true)
		setCreateBusy(false)
		let target = destinationPath
		let createdDirectory:
			| {
					path: string
					identity: {device: number; inode: number; birthtimeMs: number}
			  }
			| undefined
		try {
			if (!destinationPicked) {
				// Re-check the proposed name right before creating, then rely on the
				// atomic creation result to close the listing/create race.
				const taken = await fetchTakenNames(homePath)
				const base = target.split('/').filter(Boolean).at(-1) ?? ''
				for (let attempt = 0; attempt < 100; attempt++) {
					const name = deconflict(base, taken)
					target = `${homePath}/${name}`
					const result = await createDirectory.mutateAsync({path: target})
					if (result.created) {
						createdDirectory = {path: target, identity: result.identity}
						break
					}
					taken.add(name)
				}
				if (!createdDirectory) throw new Error('[unique-name-index-exceeded]')
				if (target !== destinationPath) setDestinationPath(target)
			}
			const destination = await utils.client.files.cloud.destination.query({path: target})
			await createSync({accountId, remote: remote.ref, destination, mode})
			navigateToDirectory(target)
			handleDialogOpenChange(false)
		} catch (error) {
			// Cleanup is deliberately narrow: the backend removes only the same
			// still-empty directory created by this attempt.
			if (createdDirectory) {
				await utils.client.files.cleanupCreatedDirectory.mutate(createdDirectory).catch(() => {})
			}
			const message = (error as RouterError).message ?? ''
			if (message.includes('[cloud-account-busy]')) setCreateBusy(true)
			else toast.error(t('files-cloud-error.create', {message: getFilesErrorMessage(message)}), {area: 'files'})
		} finally {
			setIsStarting(false)
		}
	}

	const stepTitles: Record<Step, {title: string; description?: string}> = {
		[Step.Source]:
			sourceView === 'picker'
				? {title: t('files-cloud.picker-title'), description: t('files-cloud.picker-description')}
				: {title: t('files-cloud.add-title')},
		[Step.Connect]: {title: t('files-cloud.connect-title', {provider: sourceName})},
		[Step.CloudFolder]: {title: t('files-cloud.folder-step-title', {provider: sourceName})},
		[Step.Destination]: {title: t('files-cloud.destination-title')},
	}
	const {title, description} = stepTitles[step]
	const reauthAccount = reauthing ? accounts?.find(({id}) => id === accountId) : undefined

	// The pitch is a poster with its own heading under the constellation, so the
	// dialog header there exists for screen readers only. The connect and folder
	// steps are centered compositions, so their headers center with them.
	const headerHidden = step === Step.Source && sourceView !== 'picker'
	const headerCentered = step === Step.Connect || step === Step.CloudFolder

	const header = isMobile ? (
		<DrawerHeader className={cn(headerHidden && 'sr-only', headerCentered && 'text-center')}>
			<DrawerTitle>{title}</DrawerTitle>
			{description ? <DrawerDescription>{description}</DrawerDescription> : null}
		</DrawerHeader>
	) : (
		<DialogHeader className={cn(headerHidden && 'sr-only', headerCentered && 'items-center text-center')}>
			<DialogTitle>{title}</DialogTitle>
			{description ? <DialogDescription>{description}</DialogDescription> : null}
		</DialogHeader>
	)

	// Steps crossfade concurrently (popLayout floats the leaving step) so the
	// shared logo plate has both its origin and destination mounted and flies
	// between them without a stutter; the body height glides underneath.
	const reducedMotion = useReducedMotion() ?? false
	const stepFade = {
		initial: {opacity: 0},
		animate: {opacity: 1},
		exit: {opacity: 0},
		transition: {duration: reducedMotion ? 0 : 0.18},
	}

	const body = (
		<div className='umbrel-stable-gutter flex-1 overflow-x-hidden overflow-y-auto'>
			<AnimatedHeight transition={{type: 'spring', stiffness: 300, damping: 34}} contentClassName='relative'>
				{/* wait: the outgoing step must finish leaving before the next one mounts, or both footers overlap */}
				<AnimatePresence mode='wait' initial={false}>
					{step === Step.Source && (
						<motion.div key='source' {...stepFade}>
							<SourceStep
								providers={providers}
								accounts={accounts}
								isLoading={isLoadingProviders || isLoadingAccounts || sourceView === null}
								view={sourceView ?? 'picker'}
								onEnterPicker={() => setSourceView('picker')}
								onSelectAccount={handleSelectAccount}
								onReauthAccount={startReauth}
								onSelect={({provider: selected, flavor}) => {
									invalidateLocationRequests()
									setProvider(selected)
									setWebdavFlavor(flavor ?? null)
									setAccountId(null)
									setLocations(null)
									setCloudPickerOpen(false)
									setDestinationPickerOpen(false)
									setRemote(null)
									remoteRefMap.current.clear()
									setReauthing(false)
									setStep(Step.Connect)
								}}
							/>
						</motion.div>
					)}
					{step === Step.Connect && provider && (
						<motion.div key='connect' {...stepFade}>
							<ConnectStep
								provider={provider}
								flavor={webdavFlavor ?? undefined}
								reauthAccountId={reauthing && accountId ? accountId : undefined}
								savedWebDavConnection={
									reauthAccount?.connection.kind === 'webdav' ? reauthAccount.connection : undefined
								}
								morph={!reauthing}
								onConnected={handleConnected}
								onBack={() => {
									setReauthing(false)
									setStep(Step.Source)
								}}
							/>
						</motion.div>
					)}
					{step === Step.CloudFolder && provider && (
						<motion.div key='folder' {...stepFade}>
							<CloudFolderStep
								displayName={sourceName}
								logo={CLOUD_PROVIDER_LOGOS[webdavFlavor ?? provider.id]}
								layoutKey={webdavFlavor ?? provider.id}
								morph={cameFromConnect}
								state={folderState}
								isPersonalOneDrive={isPersonalOneDrive}
								onRetry={() => accountId && loadLocations(accountId)}
								onOpenPicker={() => setCloudPickerOpen(true)}
								onDownloadAll={handleDownloadAll}
								onSignIn={() => {
									invalidateLocationRequests()
									setCloudPickerOpen(false)
									setReauthing(true)
									setStep(Step.Connect)
								}}
								onBack={() => {
									invalidateLocationRequests()
									setCloudPickerOpen(false)
									setStep(Step.Source)
								}}
							/>
						</motion.div>
					)}
					{step === Step.Destination && provider && remote && (
						<motion.div key='destination' {...stepFade}>
							<DestinationStep
								providerName={sourceName}
								destinationPath={destinationPath}
								isProposing={isProposing}
								changeable={!prefilledDestination}
								wholeCloud={wholeCloud}
								mode={mode}
								createBusy={createBusy}
								isStarting={isStarting}
								onChange={() => setDestinationPickerOpen(true)}
								onModeChange={setMode}
								onBack={() => {
									setStep(Step.CloudFolder)
									// Multi-root skips the folder step, so back means the browser
									if ((locations?.locations.length ?? 0) > 1) setCloudPickerOpen(true)
								}}
								onStart={handleStart}
							/>
						</motion.div>
					)}
				</AnimatePresence>
			</AnimatedHeight>
		</div>
	)

	// The wizard hides (but keeps its state) while a folder picker dialog is on screen
	const wizardOpen = dialogProps.open && !cloudPickerOpen && !destinationPickerOpen

	const handleDialogOpenChange = (open: boolean) => {
		if (!open) {
			invalidateLocationRequests()
			setCloudPickerOpen(false)
			setDestinationPickerOpen(false)
		}
		dialogProps.onOpenChange(open)
	}

	return (
		<>
			{isMobile ? (
				<Drawer open={wizardOpen} onOpenChange={handleDialogOpenChange}>
					<DrawerContent fullHeight>
						{header}
						<DrawerScroller>{body}</DrawerScroller>
					</DrawerContent>
				</Drawer>
			) : (
				<Dialog open={wizardOpen} onOpenChange={handleDialogOpenChange}>
					<DialogContent className='flex flex-col'>
						{header}
						{body}
					</DialogContent>
				</Dialog>
			)}

			{/* Cloud folder picker */}
			{provider && accountId && locations && (
				<MiniBrowser
					open={dialogProps.open && cloudPickerOpen}
					onOpenChange={(open) => {
						if (open) return
						setCloudPickerOpen(false)
						// With several roots the picker replaces the folder step entirely,
						// so cancelling returns to the account list, not the skipped screen
						if (step === Step.CloudFolder && locations.locations.length > 1) setStep(Step.Source)
					}}
					rootPath={CLOUD_BROWSE_ROOT}
					listDirectory={listCloudDirectory}
					preselectOnOpen={false}
					selectionMode='folders'
					title={t('files-cloud.folder-title', {provider: sourceName})}
					subtitle={truncated ? t('files-cloud.folder-truncated') : undefined}
					selectButtonLabel={t('files-cloud.folder-choose')}
					onSelect={handleCloudFolderPicked}
				/>
			)}

			{/* Destination folder picker: chooses the (empty) destination itself */}
			<MiniBrowser
				open={dialogProps.open && destinationPickerOpen}
				onOpenChange={(open) => {
					if (!open) setDestinationPickerOpen(false)
				}}
				rootPath={homePath}
				rootPaths={destinationRootPaths}
				onOpenPath={destinationPath ?? homePath}
				selectionMode='folders'
				selectableFilter={(entry) => entry.type === 'directory' && isValidCloudDestination(entry.path, homePath)}
				allowNewFolderCreation
				title={t('files-cloud.destination-picker-title')}
				selectButtonLabel={t('files-cloud.destination-picker-select')}
				onSelect={(path) => {
					setDestinationPath(path)
					setDestinationPicked(true)
					setDestinationPickerOpen(false)
				}}
			/>
		</>
	)
}
