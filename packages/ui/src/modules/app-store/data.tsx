import {keyBy} from 'lodash-es'

import {Category} from '@/trpc/trpc'

export type Categoryish = Category | 'all' | 'discover'

export const categoryDescriptions = [
	{id: 'discover', label: 'Discover'},
	{id: 'all', label: 'All'},
	{id: 'files', label: 'Files'},
	{id: 'bitcoin', label: 'Bitcoin'},
	{id: 'media', label: 'Media'},
	{id: 'networking', label: 'Networking'},
	{id: 'social', label: 'Social'},
	{id: 'automation', label: 'Automation'},
	{id: 'finance', label: 'Finance'},
	{id: 'ai', label: 'AI'},
	{id: 'developer', label: 'Developer'},
] as const satisfies readonly {id: Categoryish; label: string}[]

type CategoryDescription = (typeof categoryDescriptions)[number]

export const categoryDescriptionsKeyed = keyBy(categoryDescriptions, 'id') as {
	[K in Categoryish]: CategoryDescription
}
