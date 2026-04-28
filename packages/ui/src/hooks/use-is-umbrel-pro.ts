import {trpcReact} from '@/trpc/trpc'

export function useIsUmbrelPro() {
	const isUmbrelProQ = trpcReact.hardware.umbrelPro.isUmbrelPro.useQuery()
	const isUmbrelPro = !!isUmbrelProQ.data
	return {
		isUmbrelPro,
		isLoading: isUmbrelProQ.isLoading,
	}
}
