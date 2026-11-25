import {keepPreviousData} from '@tanstack/react-query'
import {useDeferredValue, useMemo, useRef, type ReactNode} from 'react'
import {useTranslation} from 'react-i18next'
import {useNavigate} from 'react-router-dom'

import {
	bestSearchGrade,
	CMDK_MATCH,
	createCmdkMatcher,
	orderSectionsByMatch,
	rankCmdkEntries,
	rankCmdkEntriesScored,
	sortByMatch,
	splitSearchResults,
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
import {getLastFilesPath} from '@/features/files/utils/last-files-path'
import {useMachinesCmdkEntries} from '@/features/machines/cmdk-entries'
import type {Item as PhotoItem} from '@/features/photos/hooks/use-items'
import {takenAtClock} from '@/features/photos/utils/taken-at'
import type {SearchChip, SearchResult, SearchScope} from '@/features/search/types'
import {useSearch, useSearchStatus} from '@/features/search/use-search'
import {useSearchFootnote, type SearchFootnoteLine} from '@/features/search/use-search-footnote'
import {useAppsWithUpdates} from '@/hooks/use-apps-with-updates'
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
// the App Store's local index, and one server search — everything Search
// understands about files and photos, already ranked — that arrives a beat
// after typing stops.

export type CmdkItem = {
	value: string
	title: string
	subtitle?: string
	disabled?: boolean
	icon?: string | ReactNode
	iconVariant?: 'bare' | 'tile'
	// Photo tiles render the library's thumbnail for this item
	photo?: Pick<PhotoItem, 'id' | 'tint' | 'kind' | 'durationMs'>
	// Results explain their match (a snippet, a page, a folder) from this: a
	// row on its second line, a photo tile under the grid while it is selected.
	// A tile also wears the moment of a video it matched at.
	result?: SearchResult
	onSelect?: () => void
}

export type CmdkSection = {
	id: string
	// 'results' are search results as rows: a thumbnail, a name, and why it matched
	layout: 'list' | 'tiles' | 'photos' | 'results'
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
	// The parts of the query Search took as filters, shown under the field
	chips?: readonly SearchChip[]
	// One quiet line under the results: Search still catching up, or failing
	footnote?: SearchFootnoteLine
	// How the search of what is inside files is going (see CmdkInsight)
	insight: CmdkInsight
}

// What the palette shows of Search's understanding — the sparkle in the
// field, the orb's thinking and its glow, the light round the card:
//   off         no search of contents here: nothing typed, App Store or
//               Settings, or a device that only matches names
//   thinking    asked, not yet answered (typing included: the question is
//               being put)
//   understood  answered, and some of what is shown was found by what is
//               in it — how it looks, the words read off it or inside it, what
//               is said in it
//   plain       answered, and everything shown matched by name, or nothing did
export type CmdkInsight = {
	state: 'off' | 'thinking' | 'understood' | 'plain'
	// Of the results shown, how many were found each way
	matches: {visual: number; text: number; speech: number}
	// The query the answer on screen is for: a new one is a new arrival
	answer: string
}

const NO_MATCHES = {visual: 0, text: 0, speech: 0}
const INSIGHT_OFF: CmdkInsight = {state: 'off', matches: NO_MATCHES, answer: ''}

function countMatches(items: CmdkItem[]) {
	const matches = {visual: 0, text: 0, speech: 0}
	for (const item of items) {
		const match = item.result?.match
		if (match && match !== 'name') matches[match]++
	}
	return matches
}

const NO_APPS: never[] = []
const EVERYWHERE_HITS = 5
const EVERYWHERE_TILES = 6
const EVERYWHERE_ROWS = 5
const DOMAIN_TILES = 12
const FREQUENT_APPS = 6
// What one search asks for. Everywhere shares its answer between a row of
// photo tiles and a few file rows, so it asks for enough to fill both.
const SEARCH = {
	everywhere: {scope: 'everything', limit: 30},
	files: {scope: 'files', limit: 12},
	photos: {scope: 'photos', limit: 18},
} as const satisfies Record<string, {scope: SearchScope; limit: number}>

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
	// A new function every render: the sources below read the latest through
	// a ref, so their results are rebuilt only when what they found changes
	const open = useLatest((to: string) => {
		navigate(to)
		close()
	})
	const searchParam = new URLSearchParams({q: trimmedQuery}).toString()

	const searchDomain = domain === 'everywhere' || domain === 'files' || domain === 'photos' ? domain : undefined
	const wantsApps = domain === 'app-store' || (domain === 'everywhere' && hasQuery)
	const tileLimit = domain === 'everywhere' ? EVERYWHERE_TILES : DOMAIN_TILES

	const found = useSearchResults(active && hasQuery ? searchDomain : undefined, trimmedQuery, close, open)
	const apps = useAppStoreResults(wantsApps ? trimmedQuery : undefined, tileLimit, open)
	const recentPhotos = useRecentPhotos(active && domain === 'photos' && !hasQuery, DOMAIN_TILES, open)
	const frequent = useFrequentApps(domain === 'everywhere' && !hasQuery, close)
	const {files, photos} = found
	const searching = hasQuery && searchDomain !== undefined
	// A search that could not be made is not one that found nothing
	const failed = searching && found.failed
	const failure = t('cmdk.search-failed')
	// Only where a search is showing: what it understood, and how ready it is
	const understood = searching ? {chips: found.chips, footnote: failed ? {text: failure} : found.footnote} : {}
	// The first answer of a search is awaited as placeholders where its
	// results will be, so the card takes its size once instead of collapsing
	// to a line and growing again. An answer that found nothing stands like
	// any other while it is refined: awaited again at every keystroke, the
	// placeholders would blink in and out for as long as nothing is found.
	const awaited = found.searching && found.answeredQuery === '' && files.items.length === 0 && photos.items.length === 0
	// An answer that found nothing is named by the words it answers, which
	// trail the field while it is refined
	const emptyQuery = found.answeredQuery || trimmedQuery
	const insight = useMemo((): CmdkInsight => {
		if (!searching || !found.smart || failed) return INSIGHT_OFF
		if (found.searching) return {state: 'thinking', matches: NO_MATCHES, answer: found.answeredQuery}
		const matches = countMatches([...files.items, ...photos.items])
		const understood = matches.visual + matches.text + matches.speech > 0
		return {state: understood ? 'understood' : 'plain', matches, answer: found.answeredQuery}
	}, [searching, found.smart, failed, found.searching, found.answeredQuery, files.items, photos.items])

	if (!entries) return {ready: false, sections: [], insight: INSIGHT_OFF}

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
		onSelect: () => open.current(to),
	})
	const filesMore = () => open.current(`/files${FILES_SEARCH_PATH}?${searchParam}`)
	const appsMore = () => open.current(`/app-store?${searchParam}`)
	const photosMore = () => open.current(`/photos?${searchParam}`)

	if (domain === 'everywhere') {
		if (!hasQuery) {
			const sections: CmdkSection[] = []
			if (frequent.length > 0) {
				sections.push({id: 'frequent', title: t('cmdk.frequent-apps'), layout: 'tiles', items: frequent})
			}
			sections.push({id: 'defaults', layout: 'list', items: entries.filter((entry) => entry.default).map(entryItem)})
			return {ready: true, sections, insight}
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
		if (files.items.length > 0 || awaited) {
			ranked.push({
				section: {
					id: 'files',
					title: label('files'),
					icon: filesIcon,
					layout: 'results',
					items: files.items,
					more: awaited ? undefined : filesMore,
					loading: awaited,
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
		if (photos.items.length > 0 || awaited) {
			ranked.push({
				section: {
					id: 'photos',
					title: label('photos'),
					icon: photosIcon,
					layout: 'photos',
					items: photos.items,
					more: awaited ? undefined : photosMore,
					loading: awaited,
				},
				bestMatch: photos.bestMatch,
				priority: 3,
			})
		}
		const sections = orderSectionsByMatch(ranked).map(({section}) => section)
		return {
			ready: true,
			insight,
			sections,
			empty: failed ? failure : t('no-results-found'),
			...understood,
			// Said once: with nothing else to show, the failure is the empty line
			...(failed && sections.length === 0 && {footnote: undefined}),
		}
	}

	if (domain === 'files') {
		if (!hasQuery) {
			const links = entries.filter((entry) => entry.id === 'system:files' || entry.id.startsWith('files:'))
			return {ready: true, sections: [{id: 'files-links', layout: 'list', items: links.map(entryItem)}], insight}
		}
		const section: CmdkSection = {id: 'files', layout: 'results', items: files.items, loading: awaited}
		const sections = files.items.length > 0 || awaited ? [section] : []
		return {
			ready: true,
			insight,
			sections,
			footer: openIn('files', `/files${FILES_SEARCH_PATH}?${searchParam}`),
			empty: failed ? failure : t('cmdk.empty.files', {query: emptyQuery}),
			...understood,
			...(failed && sections.length === 0 && {footnote: undefined}),
		}
	}

	if (domain === 'app-store') {
		const section: CmdkSection = {id: 'apps', layout: 'tiles', items: apps.items, loading: apps.loading}
		return {
			ready: true,
			insight,
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
			insight,
			sections: items.length > 0 ? [{id: 'settings', layout: 'list', items}] : [],
			empty: t('cmdk.empty.settings', {query: trimmedQuery}),
		}
	}

	// Photos
	const library = hasQuery ? {items: photos.items, loading: awaited} : recentPhotos
	const section: CmdkSection = {
		id: 'photos',
		layout: 'photos',
		items: library.items,
		loading: library.loading,
		title: hasQuery ? undefined : t('cmdk.photos-recent'),
	}
	const sections = library.items.length > 0 || library.loading ? [section] : []
	return {
		ready: true,
		insight,
		sections,
		footer: openIn('photos', hasQuery ? `/photos?${searchParam}` : '/photos'),
		empty: failed ? failure : hasQuery ? t('cmdk.empty.photos', {query: emptyQuery}) : t('cmdk.empty.photos-library'),
		...understood,
		...(failed && sections.length === 0 && {footnote: undefined}),
	}
}

// The one server search behind the Files and Photos sections. Its results
// arrive ranked and stay in that order; they are only dealt out — library
// photos and videos to tiles, everything else to rows — and each section is
// graded so it can take its place among the local ones.
function useSearchResults(
	domain: keyof typeof SEARCH | undefined,
	query: string,
	close: () => void,
	open: Latest<(to: string) => void>,
) {
	const {navigateToItem} = useFilesNavigate()
	// A new function every render; a selection reads the latest through a ref,
	// so the items below are rebuilt only when the results change
	const navigateToItemRef = useLatest(navigateToItem)
	const {scope, limit} = SEARCH[domain ?? 'everywhere']
	// Fresh on every visit: the palette stands its search down while closed
	// (see `active`), and an answer a minute old is what a reopen must not show
	const search = useSearch({query, scope, limit, enabled: domain !== undefined, staleTime: 0})
	const status = useSearchStatus(domain !== undefined)
	const footnote = useSearchFootnote(domain ?? 'everywhere', status)
	const {results, answeredQuery} = search

	const sections = useMemo(() => {
		const split = splitSearchResults(results)
		const everywhere = domain === 'everywhere'
		const photos = split.photos.slice(0, everywhere ? EVERYWHERE_TILES : limit)
		const files = split.files.slice(0, everywhere ? EVERYWHERE_ROWS : limit)
		// Graded against the query these results answer, not the one being typed
		const match = createCmdkMatcher(answeredQuery)
		return {
			photos: {
				items: photos.map(
					(result): CmdkItem => ({
						value: `photo:${result.id}`,
						title: result.file.name,
						photo: result.photo,
						result,
						// Into the lightbox, which walks this same search: the query
						// rides along, and a matched moment is where playback starts
						onSelect: () =>
							open.current(
								`/photos?${new URLSearchParams({
									q: answeredQuery,
									dialog: 'photos-item',
									'photos-item-id': result.photo!.id,
									...(result.moment && {'photos-item-t': String(result.moment.startMs)}),
								})}`,
							),
					}),
				),
				bestMatch: bestSearchGrade(photos, match),
			},
			files: {
				items: files.map((result): CmdkItem => {
					const item = {...result.file, searchResult: result}
					return {
						value: `file:${result.id}`,
						title: result.file.name,
						icon: <FileItemIcon item={item} className='size-full' showBadges={false} />,
						result,
						onSelect: () => {
							navigateToItemRef.current(item)
							close()
						},
					}
				}),
				bestMatch: bestSearchGrade(files, match),
			},
		}
	}, [results, answeredQuery, domain, limit, navigateToItemRef, open, close])

	return {
		...sections,
		chips: search.chips,
		footnote,
		searching: search.isSearching,
		failed: search.isError,
		// Whether this device reads what is inside files at all (not until Search
		// says so: a name-only device must never sparkle)
		smart: status?.available === true,
		answeredQuery,
	}
}

function useAppStoreResults(requested: string | undefined, limit: number, open: Latest<(to: string) => void>) {
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
				onSelect: () => open.current(`/app-store/${app.id}`),
			})),
			// Anything Fuse returned is at least a fuzzy hit
			bestMatch: sorted.length > 0 && match ? Math.max(CMDK_MATCH.subsequence, matchOf(sorted[0])) : CMDK_MATCH.none,
		}
	}, [apps, search, query, limit, open])
	return {items, bestMatch, loading: query !== undefined && availableApps.isLoading}
}

// The newest of the library, for the Photos scope before anything is typed
function useRecentPhotos(enabled: boolean, limit: number, open: Latest<(to: string) => void>) {
	const {i18n} = useTranslation()
	// An infinite query like the library's own lists (see use-items.ts): the
	// Photos feature patches and refreshes every cached list under this key
	// prefix as {pages}, so a differently shaped entry would break its actions
	const list = trpcReact.photos.items.list.useInfiniteQuery(
		{filter: {}, limit},
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
				? (list.data?.pages[0]?.items ?? []).map((item) => {
						// The day by the clock the photo was taken by, as Photos shows it, not the browser's time zone
						const clock = takenAtClock(item.takenAt, item.takenAtOffsetMinutes)
						return {
							value: `photo:${item.id}`,
							title: clock.date.toLocaleDateString(i18n.language, {timeZone: clock.timeZone}),
							photo: item,
							// Straight into the lightbox: a deep link the viewer resolves on its own
							onSelect: () =>
								open.current(`/photos?${new URLSearchParams({dialog: 'photos-item', 'photos-item-id': item.id})}`),
						}
					})
				: [],
		[enabled, list.data, open, i18n.language],
	)
	return {items, loading: enabled && !list.isError && list.isLoading}
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

type Latest<T> = {readonly current: T}

function useLatest<T>(value: T): Latest<T> {
	const ref = useRef(value)
	ref.current = value
	return ref
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
	// Update all apps leads the suggestions only when there's something to update
	const hasAppUpdates = useAppsWithUpdates().appsWithUpdates.length > 0

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
		hasAppUpdates,
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
			// Updating apps is the owner's
			...(isMember
				? []
				: [
						{
							id: 'system:update-all-apps',
							title: t('cmdk.update-all-apps'),
							default: hasAppUpdates,
							icon: appStore.icon,
							onSelect: () => navigate('/app-store?dialog=updates'),
						},
					]),
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
							title: t('machines'),
							default: true,
							icon: machines.icon,
							onSelect: () => navigate(machines.systemAppTo),
						},
					]),
			{
				id: 'system:app-store',
				title: t('app-store.title'),
				icon: appStore.icon,
				onSelect: () => navigate(appStore.systemAppTo),
			},
			{
				id: 'system:files',
				title: t('files'),
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
			{id: 'system:photos', title: t('photos'), icon: photos.icon, onSelect: () => navigate(photos.systemAppTo)},
			{
				id: 'system:settings',
				title: t('settings'),
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
					subtitle: t('cmdk.in-app-store'),
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
