import {keepPreviousData} from '@tanstack/react-query'
import {useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode} from 'react'
import {useTranslation} from 'react-i18next'
import {useNavigate} from 'react-router-dom'

import {
	CMDK_MATCH,
	createCmdkMatcher,
	orderSectionsByMatch,
	rankCmdkEntries,
	rankCmdkEntriesScored,
	sortByMatch,
	type CmdkEntry,
} from '@/components/cmdk-search'
import {createAppStoreSearch} from '@/features/app-store/data/search'
import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {
	APPS_PATH as FILES_APPS_PATH,
	MACHINES_PATH as FILES_MACHINES_PATH,
	RECENTS_PATH as FILES_RECENTS_PATH,
	SEARCH_PATH as FILES_SEARCH_PATH,
	TRASH_PATH as FILES_TRASH_PATH,
} from '@/features/files/constants'
import {useNavigate as useFilesNavigate} from '@/features/files/hooks/use-navigate'
import {useSearchFiles} from '@/features/files/hooks/use-search-files'
import {getLastFilesPath} from '@/features/files/utils/last-files-path'
import {useMachinesCmdkEntries} from '@/features/machines/cmdk-entries'
import type {Item as PhotoItem} from '@/features/photos/hooks/use-items'
import {useDebugInstallRandomApps} from '@/hooks/use-debug-install-random-apps'
import {useLaunchApp} from '@/hooks/use-launch-app'
import {useShortcuts} from '@/hooks/use-shortcuts'
import {appStateToString} from '@/modules/app-store/app-state-strings'
import {resolveShortcutUrl} from '@/modules/desktop/shortcut-dialog'
import {resolveShortcutIcon, ShortcutIconImage} from '@/modules/desktop/shortcut-icon-image'
import {systemAppsKeyed, useApps} from '@/providers/apps'
import {useAvailableApps} from '@/providers/available-apps'
import {useSettingsCmdkEntries} from '@/routes/settings/cmdk-entries'
import {trpcReact} from '@/trpc/trpc'
import {IS_DEV} from '@/utils/misc'

import {cmdkDomainIcon, useCmdkDomainCopy, type CmdkDomain} from './cmdk-domain'

// What the palette shows for a domain and query: sections of items, in the
// order they render, plus an optional footer link out to the app that owns
// the domain. Sources are the ranked local entries (apps, settings, actions),
// the App Store's local index, and two server searches — files and photos —
// that arrive a beat after typing stops.

export type CmdkItem = {
	value: string
	title: string
	subtitle?: string
	disabled?: boolean
	icon?: string | ReactNode
	iconVariant?: 'bare' | 'tile'
	// Photo tiles render the library's thumbnail for this item
	photo?: Pick<PhotoItem, 'id' | 'tint'>
	onSelect?: () => void
}

export type CmdkSection = {
	id: string
	layout: 'list' | 'tiles' | 'photos'
	items: CmdkItem[]
	title?: string
	icon?: string
	// "More" in the section header: the same search, in the app
	more?: () => void
	// A server search still on its way; shown as placeholders when nothing is here yet
	loading?: boolean
}

// The value of a section's "More" link — a selectable item too, so it needs a value cmdk can hold
export const cmdkMoreValue = (sectionId: string) => `more:${sectionId}`

export type CmdkResults = {
	// The local entries take a moment on first open; nothing renders until then
	ready: boolean
	sections: CmdkSection[]
	// "Open in Files" and friends, below a domain's results
	footer?: CmdkItem
	// Shown when there are no sections
	empty?: string
}

const NO_APPS: never[] = []
const EVERYWHERE_HITS = 5
const EVERYWHERE_TILES = 6
const DOMAIN_TILES = 12
const FREQUENT_APPS = 6
const PHOTOS_DEBOUNCE_MS = 250

export function useCmdkResults({
	domain,
	query,
	active,
	close,
}: {
	domain: CmdkDomain
	query: string
	// While the palette is closed the server searches stand down, so the next
	// open fetches afresh rather than showing what was cached last time
	active: boolean
	close: () => void
}): CmdkResults {
	const {t} = useTranslation()
	const {label} = useCmdkDomainCopy()
	const navigate = useNavigate()
	const trimmedQuery = query.trim()
	const hasQuery = trimmedQuery.length > 0
	const entries = useCmdkEntries()
	const open = (to: string) => {
		navigate(to)
		close()
	}
	const searchParam = new URLSearchParams({q: trimmedQuery}).toString()

	const wantsFiles = active && (domain === 'files' || (domain === 'everywhere' && hasQuery))
	const wantsApps = domain === 'app-store' || (domain === 'everywhere' && hasQuery)
	const wantsPhotos = active && (domain === 'photos' || (domain === 'everywhere' && hasQuery))
	const tileLimit = domain === 'everywhere' ? EVERYWHERE_TILES : DOMAIN_TILES

	const files = useFileResults(wantsFiles && hasQuery ? trimmedQuery : '', tileLimit, close)
	const apps = useAppStoreResults(wantsApps ? trimmedQuery : undefined, tileLimit, open)
	const photos = usePhotoResults(wantsPhotos ? trimmedQuery : undefined, tileLimit, open)
	const frequent = useFrequentApps(domain === 'everywhere' && !hasQuery, close)

	if (!entries) return {ready: false, sections: []}

	const entryItem = (entry: CmdkEntry): CmdkItem => ({
		value: entry.id,
		title: entry.title,
		subtitle: entry.subtitle,
		disabled: entry.disabled,
		icon: entry.icon,
		iconVariant: entry.iconVariant,
		onSelect: () => {
			entry.onSelect?.()
			close()
		},
	})
	const appStoreIcon = cmdkDomainIcon('app-store')
	const filesIcon = cmdkDomainIcon('files')
	const photosIcon = cmdkDomainIcon('photos')
	const openIn = (app: 'files' | 'app-store' | 'photos', to: string): CmdkItem => ({
		value: `open-in:${app}`,
		title: t('cmdk.open-in', {app: label(app)}),
		icon: cmdkDomainIcon(app),
		onSelect: () => open(to),
	})
	const filesMore = () => open(`/files${FILES_SEARCH_PATH}?${searchParam}`)
	const appsMore = () => open(`/app-store?${searchParam}`)
	const photosMore = () => open(`/photos?${searchParam}`)

	if (domain === 'everywhere') {
		if (!hasQuery) {
			const sections: CmdkSection[] = []
			if (frequent.length > 0) {
				sections.push({id: 'frequent', title: t('cmdk.frequent-apps'), layout: 'tiles', items: frequent})
			}
			sections.push({id: 'defaults', layout: 'list', items: entries.filter((entry) => entry.default).map(entryItem)})
			return {ready: true, sections}
		}
		// Every source grades its results on the same scale, and the source
		// holding the best match leads: a folder named "Downloads" outranks an
		// app that mentions downloading, and both outrank a settings page whose
		// description happens to contain the word. Between equals, the kind of
		// result decides — actions and installed things, then files, the store,
		// the library.
		const hits = rankCmdkEntriesScored(
			entries.filter((entry) => !entry.id.startsWith('store:')),
			trimmedQuery,
			EVERYWHERE_HITS,
		)
		const ranked: {section: CmdkSection; bestMatch: number; priority: number}[] = []
		if (hits.length > 0) {
			ranked.push({
				section: {id: 'hits', layout: 'list', items: hits.map(({entry}) => entryItem(entry))},
				bestMatch: hits[0].score,
				priority: 0,
			})
		}
		if (files.items.length > 0) {
			ranked.push({
				section: {
					id: 'files',
					title: label('files'),
					icon: filesIcon,
					layout: 'tiles',
					items: files.items,
					more: filesMore,
				},
				bestMatch: files.bestMatch,
				priority: 1,
			})
		}
		if (apps.items.length > 0) {
			ranked.push({
				section: {
					id: 'apps',
					title: label('app-store'),
					icon: appStoreIcon,
					layout: 'tiles',
					items: apps.items,
					more: appsMore,
				},
				bestMatch: apps.bestMatch,
				priority: 2,
			})
		}
		if (photos.items.length > 0) {
			ranked.push({
				section: {
					id: 'photos',
					title: label('photos'),
					icon: photosIcon,
					layout: 'photos',
					items: photos.items,
					more: photosMore,
				},
				bestMatch: photos.bestMatch,
				priority: 3,
			})
		}
		const searching = files.loading || photos.loading
		return {
			ready: true,
			sections: orderSectionsByMatch(ranked).map(({section}) => section),
			empty: searching ? t('cmdk.searching') : t('no-results-found'),
		}
	}

	if (domain === 'files') {
		if (!hasQuery) {
			const links = entries.filter((entry) => entry.id === 'system:files' || entry.id.startsWith('files:'))
			return {ready: true, sections: [{id: 'files-links', layout: 'list', items: links.map(entryItem)}]}
		}
		const section: CmdkSection = {id: 'files', layout: 'tiles', items: files.items, loading: files.loading}
		return {
			ready: true,
			sections: files.items.length > 0 || files.loading ? [section] : [],
			footer: openIn('files', `/files${FILES_SEARCH_PATH}?${searchParam}`),
			empty: t('cmdk.empty.files', {query: trimmedQuery}),
		}
	}

	if (domain === 'app-store') {
		const section: CmdkSection = {id: 'apps', layout: 'tiles', items: apps.items, loading: apps.loading}
		return {
			ready: true,
			sections: apps.items.length > 0 || apps.loading ? [section] : [],
			footer: openIn('app-store', hasQuery ? `/app-store?${searchParam}` : '/app-store'),
			empty: t('cmdk.empty.app-store', {query: trimmedQuery}),
		}
	}

	if (domain === 'settings') {
		const settings = entries.filter((entry) => entry.id.startsWith('settings:'))
		const items = (hasQuery ? rankCmdkEntries(settings, trimmedQuery, settings.length) : settings).map((entry) =>
			// The subtitle "in Settings" is noise when everything is
			entryItem({...entry, subtitle: undefined}),
		)
		return {
			ready: true,
			sections: items.length > 0 ? [{id: 'settings', layout: 'list', items}] : [],
			empty: t('cmdk.empty.settings', {query: trimmedQuery}),
		}
	}

	// Photos
	const section: CmdkSection = {
		id: 'photos',
		layout: 'photos',
		items: photos.items,
		loading: photos.loading,
		title: hasQuery ? undefined : t('cmdk.photos-recent'),
	}
	return {
		ready: true,
		sections: photos.items.length > 0 || photos.loading ? [section] : [],
		footer: openIn('photos', hasQuery ? `/photos?${searchParam}` : '/photos'),
		empty: hasQuery ? t('cmdk.empty.photos', {query: trimmedQuery}) : t('cmdk.empty.photos-library'),
	}
}

function useFileResults(query: string, limit: number, close: () => void) {
	const {navigateToItem} = useFilesNavigate()
	// Fresh on every visit: the palette stands its searches down while closed
	// (see `active`), and results a minute old are what a reopen must not show
	const {results, isLoading, isDebouncing} = useSearchFiles({
		query,
		maxResults: limit,
		keepPreviousResults: true,
		staleTime: 0,
	})
	const {items, bestMatch} = useMemo(() => {
		const match = query ? createCmdkMatcher(query) : null
		if (!match) return {items: [] as CmdkItem[], bestMatch: CMDK_MATCH.none}
		// The server's fuzzy order, with exact and prefix name matches lifted
		// to the front
		const sorted = sortByMatch(results.slice(0, limit), (item) => match(item.name))
		return {
			items: sorted.map((item) => ({
				value: `file:${item.path}`,
				title: item.name,
				icon: <FileItemIcon item={item} className='size-full' showBadges={false} />,
				onSelect: () => {
					navigateToItem(item)
					close()
				},
			})),
			// A file the server matched is at least a fuzzy hit
			bestMatch: sorted.length > 0 ? Math.max(CMDK_MATCH.subsequence, match(sorted[0].name)) : CMDK_MATCH.none,
		}
	}, [results, query, limit, navigateToItem, close])
	return {items, bestMatch, loading: query.length > 0 && (isLoading || isDebouncing)}
}

function useAppStoreResults(requested: string | undefined, limit: number, open: (to: string) => void) {
	const availableApps = useAvailableApps()
	const apps = availableApps.isLoading ? [] : availableApps.apps
	const search = useMemo(() => createAppStoreSearch(apps), [apps])
	// The fuzzy search over the whole registry is the one costly step of a
	// keystroke, so it renders a beat after the instant results rather than
	// holding them up; React drops it when another key arrives first
	const query = useDeferredValue(requested)
	const {items, bestMatch} = useMemo(() => {
		if (query === undefined) return {items: [] as CmdkItem[], bestMatch: CMDK_MATCH.none}
		const match = createCmdkMatcher(query)
		const found = match ? search(query, limit) : apps.slice(0, limit)
		// Fuse's fuzzy order, with the apps whose name says it lifted to the front
		const matchOf = (app: (typeof found)[number]) => (match ? match(app.name, app.tagline ? [app.tagline] : []) : 0)
		const sorted = match ? sortByMatch(found, matchOf) : found
		return {
			items: sorted.map((app) => ({
				value: `store:${app.id}`,
				title: app.name,
				icon: app.icon,
				iconVariant: 'tile' as const,
				onSelect: () => open(`/app-store/${app.id}`),
			})),
			// Anything Fuse returned is at least a fuzzy hit
			bestMatch: sorted.length > 0 && match ? Math.max(CMDK_MATCH.subsequence, matchOf(sorted[0])) : CMDK_MATCH.none,
		}
	}, [apps, search, query, limit, open])
	return {items, bestMatch, loading: query !== undefined && availableApps.isLoading}
}

function usePhotoResults(query: string | undefined, limit: number, open: (to: string) => void) {
	const enabled = query !== undefined
	const debounced = useDebouncedValue(query ?? '', PHOTOS_DEBOUNCE_MS)
	// An infinite query like the library's own lists (see use-items.ts): the
	// Photos feature patches and refreshes every cached list under this key
	// prefix as {pages}, so a differently shaped entry would break its actions
	const list = trpcReact.photos.items.list.useInfiniteQuery(
		{filter: debounced ? {query: debounced} : {}, limit},
		{
			enabled,
			retry: false,
			staleTime: 0,
			getNextPageParam: (lastPage) => lastPage.nextCursor,
			initialCursor: undefined,
			placeholderData: keepPreviousData,
		},
	)
	const items = useMemo<CmdkItem[]>(
		() =>
			enabled
				? (list.data?.pages[0]?.items ?? []).map((item) => ({
						value: `photo:${item.id}`,
						title: new Date(item.takenAt).toLocaleDateString(),
						photo: item,
						// Straight into the lightbox: a deep link the viewer resolves on its own
						onSelect: () => open(`/photos?${new URLSearchParams({dialog: 'photos-item', 'photos-item-id': item.id})}`),
					}))
				: [],
		[enabled, list.data, open],
	)
	const settling = enabled && (query ?? '') !== debounced
	// The list items carry no file name to grade, and the library matches on
	// the name: a hit is a name that contains the words
	const bestMatch = items.length > 0 && debounced ? CMDK_MATCH.substring : CMDK_MATCH.none
	return {items, bestMatch, loading: enabled && !list.isError && (list.isLoading || settling)}
}

function useFrequentApps(enabled: boolean, close: () => void) {
	const launchApp = useLaunchApp()
	const {userAppsKeyed} = useApps()
	const recent = trpcReact.apps.recentlyOpened.useQuery(undefined, {retry: false, enabled})
	return useMemo<CmdkItem[]>(() => {
		if (!enabled || !userAppsKeyed) return []
		return appsByFrequency(recent.data ?? [], FREQUENT_APPS).flatMap((appId) => {
			const app = userAppsKeyed[appId]
			if (!app) return []
			return [
				{
					value: `frequent:${appId}`,
					title: app.name,
					icon: app.icon,
					iconVariant: 'tile' as const,
					onSelect: () => {
						launchApp(appId)
						close()
					},
				},
			]
		})
	}, [enabled, recent.data, userAppsKeyed, launchApp, close])
}

export function appsByFrequency(lastOpenedApps: string[], count: number) {
	const openCounts = new Map<string, number>()
	for (const appId of lastOpenedApps) openCounts.set(appId, (openCounts.get(appId) ?? 0) + 1)
	return [...openCounts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, count)
		.map(([appId]) => appId)
}

function useLatest<T>(value: T) {
	const ref = useRef(value)
	ref.current = value
	return ref
}

function useDebouncedValue(value: string, delayMs: number) {
	const [debounced, setDebounced] = useState(value)
	useEffect(() => {
		// Clearing applies at once so stale results never outlive the text
		if (value === '') return setDebounced('')
		const handle = setTimeout(() => setDebounced(value), delayMs)
		return () => clearTimeout(handle)
	}, [value, delayMs])
	return debounced
}

// Everything the palette can find locally, in priority order: when several
// entries match a query equally well, the earlier one wins.
export function useCmdkEntries(): CmdkEntry[] | null {
	const {t} = useTranslation()
	const navigate = useNavigate()
	// These two hand back a new function every render; the entries only ever
	// call them from a selection, so they read the latest through a ref and
	// the memo below doesn't have to care
	const launchApp = useLatest(useLaunchApp())
	const debugInstallRandomApps = useLatest(useDebugInstallRandomApps())
	const userQ = trpcReact.user.get.useQuery()
	const {userApps, userAppsKeyed, isLoading: isLoadingUserApps} = useApps()
	// We only show installed community apps here, effectively limiting available
	// apps to those present in the official app store
	const availableApps = useAvailableApps()
	const {shortcuts} = useShortcuts()
	const settingsEntries = useSettingsCmdkEntries()
	const machineEntries = useMachinesCmdkEntries()
	const loading = userQ.isLoading || availableApps.isLoading || isLoadingUserApps || !userApps || !userAppsKeyed
	const userId = userQ.data?.userId
	const isMember = userQ.data?.role === 'member'
	const registryApps = availableApps.apps ?? NO_APPS

	// The list is rebuilt only when a source changes — never per keystroke
	return useMemo(() => {
		if (loading || !userApps || !userAppsKeyed) return null
		return buildEntries()
	}, [
		loading,
		userApps,
		userAppsKeyed,
		registryApps,
		shortcuts,
		settingsEntries,
		machineEntries,
		userId,
		isMember,
		t,
		navigate,
	])

	function buildEntries(): CmdkEntry[] {
		const appStore = systemAppsKeyed['UMBREL_app-store']
		const files = systemAppsKeyed['UMBREL_files']
		const photos = systemAppsKeyed['UMBREL_photos']
		const machines = systemAppsKeyed['UMBREL_machines']
		const filesEntry = (id: string, title: string, path: string): CmdkEntry => ({
			id: `files:${id}`,
			title,
			icon: files.icon,
			onSelect: () => navigate(`/files${path}`),
		})

		const systemEntries: CmdkEntry[] = [
			{
				id: 'system:update-all-apps',
				title: t('cmdk.update-all-apps'),
				default: true,
				icon: appStore.icon,
				onSelect: () => navigate('/app-store?dialog=updates'),
			},
			{
				id: 'system:live-usage',
				title: t('cmdk.live-usage'),
				default: true,
				icon: systemAppsKeyed['UMBREL_live-usage'].icon,
				onSelect: () => navigate(systemAppsKeyed['UMBREL_live-usage'].systemAppTo),
			},
			...(isMember
				? []
				: [
						{
							id: 'system:machines',
							title: machines.name,
							default: true,
							icon: machines.icon,
							onSelect: () => navigate(machines.systemAppTo),
						},
					]),
			{
				id: 'system:app-store',
				title: appStore.name,
				icon: appStore.icon,
				onSelect: () => navigate(appStore.systemAppTo),
			},
			{
				id: 'system:files',
				title: files.name,
				icon: files.icon,
				// TODO: THIS IS A HACK
				// We need a better approach to track the last visited path (possibly scroll position too?)
				// inside every page. We do this right now for the File app because it's has the most
				// UX-advantage (eg. user accidentally clicking close while they're in a deeply nested path)
				onSelect: () => navigate(getLastFilesPath(userId) || files.systemAppTo),
			},
			filesEntry('recents', t('files-sidebar.recents'), FILES_RECENTS_PATH),
			filesEntry('apps', t('files-sidebar.apps'), FILES_APPS_PATH),
			...(isMember ? [] : [filesEntry('machines', t('machines'), FILES_MACHINES_PATH)]),
			filesEntry('trash', t('files-sidebar.trash'), FILES_TRASH_PATH),
			{id: 'system:photos', title: photos.name, icon: photos.icon, onSelect: () => navigate(photos.systemAppTo)},
			{
				id: 'system:settings',
				title: systemAppsKeyed['UMBREL_settings'].name,
				icon: systemAppsKeyed['UMBREL_settings'].icon,
				onSelect: () => navigate(systemAppsKeyed['UMBREL_settings'].systemAppTo),
			},
		]

		const readyApps = userApps!.filter((app) => app.state === 'ready')
		const unreadyApps = userApps!.filter((app) => app.state !== 'ready')
		// Apps not installed yet
		const installableApps = registryApps.filter((app) => !userAppsKeyed![app.id])

		return [
			...systemEntries,
			...settingsEntries,
			...readyApps.map(
				(app): CmdkEntry => ({
					id: `app:${app.id}`,
					title: app.name,
					icon: app.icon,
					iconVariant: 'tile',
					onSelect: () => launchApp.current(app.id),
				}),
			),
			...(shortcuts ?? []).map(
				(shortcut): CmdkEntry => ({
					id: `shortcut:${shortcut.url}`,
					title: shortcut.title,
					icon: (
						<ShortcutIconImage
							src={resolveShortcutIcon(shortcut)}
							title={shortcut.title}
							className='h-full w-full rounded-6 sm:rounded-8'
						/>
					),
					onSelect: () => window.open(resolveShortcutUrl(shortcut), '_blank')?.focus(),
				}),
			),
			...machineEntries,
			...unreadyApps.map(
				(app): CmdkEntry => ({
					id: `app:${app.id}`,
					title: app.name,
					subtitle: `– ${appStateToString(app.state, t)}`,
					disabled: true,
					icon: app.icon,
					iconVariant: 'tile',
				}),
			),
			...installableApps.map(
				(app): CmdkEntry => ({
					id: `store:${app.id}`,
					title: app.name,
					subtitle: `${t('generic-in')} App Store`,
					icon: app.icon,
					iconVariant: 'tile',
					onSelect: () => navigate(`/app-store/${app.id}`),
				}),
			),
			...(IS_DEV
				? [
						{
							id: 'debug:install-random-apps',
							title: 'Install a bunch of random apps',
							onSelect: () => debugInstallRandomApps.current(),
						},
					]
				: []),
		]
	}
}
