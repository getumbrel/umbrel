import {keyBy} from 'lodash-es'

import {Category} from '@/trpc/trpc'

export type Categoryish = Category | 'all' | 'discover'

// Same order as in this app store
// https://apps.umbrel.com/category/developer
export const categoryDescriptions = [
	{id: 'discover', label: 'Discover'},
	{id: 'all', label: 'All apps'},
	{id: 'files', label: 'Files & productivity'},
	{id: 'bitcoin', label: 'Bitcoin'},
	{id: 'finance', label: 'Finance'},
	{id: 'media', label: 'Media'},
	{id: 'networking', label: 'Networking'},
	{id: 'social', label: 'Social'},
	{id: 'automation', label: 'Home & automation'},
	{id: 'ai', label: 'AI'},
	{id: 'developer', label: 'Developer tools'},
] as const satisfies readonly {id: Categoryish; label: string}[]

type CategoryDescription = (typeof categoryDescriptions)[number]

export const categoryDescriptionsKeyed = keyBy(categoryDescriptions, 'id') as {
	[K in Categoryish]: CategoryDescription
}
