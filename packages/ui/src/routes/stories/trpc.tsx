import {JSONTree} from 'react-json-tree'
import {Link} from 'react-router-dom'
import urlJoin from 'url-join'

import {Loading} from '@/components/ui/loading'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {trpcReact, trpcUrl} from '@/trpc/trpc'

const trpcEndpointUrl = urlJoin(trpcUrl, 'debug.sayHi')

export default function Trpc() {
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
			<div>
				<Link to={trpcEndpointUrl} className='underline'>
					Link to test DEBUG result
				</Link>
			</div>
			{res.data}
			<JSONTree data={getQuery.data} />
		</div>
	)
}
