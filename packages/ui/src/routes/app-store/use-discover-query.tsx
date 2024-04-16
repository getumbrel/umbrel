import {useQuery} from '@tanstack/react-query'

import {Categoryish} from '@/modules/app-store/constants'

export type Banner = {
	id: string
	image: string
}

export type Section = {
	type: string
	heading: string
	subheading: string
	apps: string[]
	textLocation?: 'left' | 'right' | undefined
	description?: string
	category?: Categoryish
}

export type DiscoverData = {
	banners: Banner[]
	sections: Section[]
}

export function useDiscoverQuery() {
	const discoverQ = useQuery<{data: DiscoverData}>({
		queryKey: ['app-store', 'discover'],
		queryFn: () => fetch('https://apps.umbrel.com/api/v2/umbrelos/app-store/discover').then((res) => res.json()),
	})

	return {...discoverQ, data: discoverQ.data?.data}
}
