import {trpcReact} from '@/trpc/trpc'

export function useVersion() {
	const {isLoading, data} = trpcReact.system.version.useQuery()
	if (isLoading || !data)
		return {isLoading: true, version: undefined, name: undefined, manifestVersion: undefined} as const
	return {
		isLoading: false,
		...data,
	} as const
}
