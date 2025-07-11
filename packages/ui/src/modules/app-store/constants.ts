import {t} from '@/utils/i18n'
import {keyBy} from '@/utils/misc'

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

export type Categoryish = Category | 'all' | 'discover'

// Same order as in this app store
// https://apps.umbrel.com/category/developer
export const categoryishDescriptions = [
	// categoryishes
	{id: 'discover', label: () => t('app-store.category.discover')},
	{id: 'all', label: () => t('app-store.category.all')},
	// categories
	{id: 'files', label: () => t('app-store.category.files')},
	{id: 'bitcoin', label: () => t('app-store.category.bitcoin')},
	{id: 'finance', label: () => t('app-store.category.finance')},
	{id: 'media', label: () => t('app-store.category.media')},
	{id: 'networking', label: () => t('app-store.category.networking')},
	{id: 'social', label: () => t('app-store.category.social')},
	{id: 'automation', label: () => t('app-store.category.automation')},
	{id: 'ai', label: () => t('app-store.category.ai')},
	{id: 'developer', label: () => t('app-store.category.developer')},
	{id: 'crypto', label: () => t('app-store.category.crypto')},
] as const satisfies readonly {id: Categoryish; label: () => string}[]

export const categoryDescriptionsKeyed = keyBy(categoryishDescriptions, 'id')

export const UMBREL_APP_STORE_ID = 'umbrel-app-store'
