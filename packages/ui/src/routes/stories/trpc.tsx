import {JSONTree} from 'react-json-tree'

import {Loading} from '@/components/ui/loading'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {trpcReact} from '@/trpc/trpc'

export function Trpc() {
	useUmbrelTitle('tRPC')

	const res = trpcReact.debug.greet.useQuery('world')

	const ctx = trpcReact.useContext()
	ctx.user.get.fetch()

	const getQuery = trpcReact.user.get.useQuery()

	if (res.isLoading) {
		return <Loading />
	}

	if (res.error) {
		return <div>Error loading</div>
	}

	return (
		<div>
			{res.data}
			<JSONTree data={getQuery.data} />
		</div>
	)
}
