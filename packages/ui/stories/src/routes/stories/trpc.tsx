import {H3} from '@stories/components'
import {useEffect, useState} from 'react'
import {JSONTree} from 'react-json-tree'
import {Link} from 'react-router-dom'

import {Loading} from '@/components/ui/loading'
import {EnsureLoggedIn} from '@/modules/auth/ensure-logged-in'
import {RouterOutput, trpcReact, trpcUrl} from '@/trpc/trpc'
import {pathJoin} from '@/utils/misc'

const trpcEndpointUrl = pathJoin(trpcUrl, 'system.status')

export default function Trpc() {
	return (
		<EnsureLoggedIn>
			<div>
				<JSONTree data={{trpcUrl, trpcEndpointUrl}} />
				<Link to={trpcEndpointUrl} className='underline'>
					Link to test DEBUG result
				</Link>
				<H3>Normal tRPC example</H3>
				<NormalUseQueryExample />
				<H3>Normal tRPC example 2</H3>
				<NormalUseQueryExample2 />
				<H3>Context example</H3>
				<ContextExample />
			</div>
		</EnsureLoggedIn>
	)
}

function NormalUseQueryExample() {
	const getQuery = trpcReact.user.get.useQuery()

	return <JSONTree data={getQuery.data} />
}

function NormalUseQueryExample2() {
	const res = trpcReact.system.online.useQuery()

	if (res.isLoading) {
		return <Loading />
	}

	if (res.error) {
		return <div>Error loading</div>
	}

	return (
		<div>
			<JSONTree data={res.data} />
		</div>
	)
}

function ContextExample() {
	const ctx = trpcReact.useContext()
	const [data, setData] = useState<RouterOutput['user']['get'] | null>(null)

	useEffect(() => {
		ctx.user.get.fetch().then((res) => {
			console.log(res)
			setData(res)
		})
	}, [ctx.user.get])

	return <JSONTree data={data} />
}
