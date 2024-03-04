import {trpcReact} from '@/trpc/trpc'

export function useIsUmbrelHome() {
	const isUmbrelHomeQ = trpcReact.migration.isUmbrelHome.useQuery()
	const isUmbrelHome = !!isUmbrelHomeQ.data
	return {
		isUmbrelHome,
		isLoading: isUmbrelHomeQ.isLoading,
	}
}
