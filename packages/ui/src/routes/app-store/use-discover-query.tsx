import {useQuery} from '@tanstack/react-query'

export type Banner = {
	id: string
	image: string
}

export type Section = {
	type: string
	heading: string
	subheading: string
	apps: string[]
}

export type DiscoverData = {
	banners: Banner[]
	sections: Section[]
}

export function useDiscoverQuery() {
	const discoverQ = useQuery<{data: DiscoverData}>({
		queryFn: () => fetch('https://apps.umbrel.com/api/v1/umbrel-os/app-store/discover').then((res) => res.json()),
	})

	return {...discoverQ, data: discoverQ.data?.data}
}
