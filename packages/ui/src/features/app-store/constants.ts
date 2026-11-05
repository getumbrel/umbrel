import {t} from '@/utils/i18n'
import {tw} from '@/utils/tw'

export {appPath, UMBREL_APP_STORE_ID} from '@/constants/app-store'

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

// The category vocabulary app manifests can use. Apps may also declare
// categories umbrelOS doesn't know about yet; those are handled dynamically.
export const categories = [
	'files',
	'bitcoin',
	'media',
	'networking',
	'social',
	'automation',
	'finance',
	'ai',
	'developer',
	'crypto',
] as const

export type Category = (typeof categories)[number]

// Category order in the navigation rail, mirroring apps.umbrel.com. The rail
// shows the Discover and All apps destinations ahead of these.
export const categoryNavOrder: readonly Category[] = [
	'files',
	'ai',
	'bitcoin',
	'media',
	'finance',
	'networking',
	'automation',
	'social',
	'developer',
	'crypto',
]

// Labels stay literal t() calls so the translation updater can find the keys
export const categoryLabels: Record<'discover' | 'all' | Category, () => string> = {
	discover: () => t('app-store.category.discover'),
	all: () => t('app-store.category.all'),
	files: () => t('app-store.category.files'),
	ai: () => t('app-store.category.ai'),
	bitcoin: () => t('app-store.category.bitcoin'),
	media: () => t('app-store.category.media'),
	finance: () => t('app-store.category.finance'),
	networking: () => t('app-store.category.networking'),
	automation: () => t('app-store.category.automation'),
	social: () => t('app-store.category.social'),
	developer: () => t('app-store.category.developer'),
	crypto: () => t('app-store.category.crypto'),
}

// Small 3D category icons bundled with the OS for offline use
// (converted from the apps.umbrel.com redesign asset set)
export function categoryIcon(navId: string): string | undefined {
	if (!(navId in categoryLabels)) return undefined
	return `/assets/app-store/categories/${navId}.webp`
}

export const APP_STORE_EMPTY_STATE_SRC = '/assets/app-store/no-results.webp'

// ---------------------------------------------------------------------------
// Remote editorial API (apps.umbrel.com)
// ---------------------------------------------------------------------------

// The storefront feed and release history are optional editorial decoration:
// every id is resolved against the local registry and any failure renders the
// complete local experience instead. See data/storefront.ts.
export const APP_STORE_REMOTE_API_BASE = 'https://apps.umbrel.com/api/v3/umbrelos/app-store'

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const DISCOVER_PATH = '/app-store'

export function categoryPath(categoryId: string) {
	return `/app-store/category/${categoryId}`
}

// ---------------------------------------------------------------------------
// Shared visual recipes
// ---------------------------------------------------------------------------

// The one section surface used across the store: the refreshed Settings-era
// edge material instead of the old ad hoc gradients.
export const storeCardClass = tw`settings-edge-material rounded-24 bg-white/4`
export const storeCardPaddedClass = tw`settings-edge-material rounded-24 bg-white/4 p-4 md:p-6`

// The single phone column is declared too: an implicit one grows to fit the
// longest app name, which ran its card off the screen instead of truncating.
export const appGridClass = tw`grid grid-cols-1 min-[560px]:grid-cols-2 xl:grid-cols-3 gap-x-2.5 gap-y-1.5`

// Bleeds a horizontally scrolling rail through the sheet's responsive padding
// (layouts/sheet.tsx) so cards scroll edge-to-edge — keep the two in sync.
export const sheetBleedClass = tw`-mx-3 px-3 md:-mx-[40px] md:px-[40px] xl:-mx-[70px] xl:px-[70px]`

// ---------------------------------------------------------------------------

// The store's shared content reveal (see index.css): sections rise gently out
// of a blur as a page appears, orchestrated with small delays so the page
// composes itself top to bottom instead of popping in at once.
export const storeRevealClass = tw`umbrel-store-reveal`
// Blur-and-fade only — for elements that also carry motion-driven transforms
// (the collapsing hero) or chrome that shouldn't visibly move
export const storeRevealSoftClass = tw`umbrel-store-reveal-soft`
// Shorter and subtler — cheap enough for every card of a large grid
export const storeRevealCardClass = tw`umbrel-store-reveal-card`
export const storeRevealDelay = (ms: number) => ({['--store-reveal-delay' as string]: `${ms}ms`})
