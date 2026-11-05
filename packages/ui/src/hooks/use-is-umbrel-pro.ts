import {trpcReact} from '@/trpc/trpc'

export function useIsUmbrelPro({enabled = true}: {enabled?: boolean} = {}) {
	const isUmbrelProQ = trpcReact.hardware.umbrelPro.isUmbrelPro.useQuery(undefined, {enabled})
	const isUmbrelPro = !!isUmbrelProQ.data
	return {
		isUmbrelPro,
		hasData: isUmbrelProQ.data !== undefined,
		isLoading: isUmbrelProQ.isLoading,
		error: isUmbrelProQ.error,
		refetch: isUmbrelProQ.refetch,
		isFetching: isUmbrelProQ.isFetching,
	}
}
