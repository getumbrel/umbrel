import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {useState} from 'react'

import {MS_PER_MINUTE} from '@/utils/date-time'
import {IS_DEV} from '@/utils/misc'

import {LoadingIndicator} from './loading-indicator'
import {links, trpcReact} from './trpc'

export const TrpcProvider: React.FC<{children: React.ReactNode}> = ({children}) => {
	const [queryClient] = useState(
		() =>
			new QueryClient({
				defaultOptions: {queries: {staleTime: MS_PER_MINUTE}},
			}),
	)

	const [trpcClient] = useState(() => trpcReact.createClient({links}))

	return (
		<trpcReact.Provider client={trpcClient} queryClient={queryClient}>
			<QueryClientProvider client={queryClient}>
				{children}
				{IS_DEV && <LoadingIndicator />}
			</QueryClientProvider>
		</trpcReact.Provider>
	)
}
