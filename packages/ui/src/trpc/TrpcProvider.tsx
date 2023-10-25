import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {ReactQueryDevtools} from '@tanstack/react-query-devtools'
import {httpBatchLink, loggerLink} from '@trpc/client'
import {useState} from 'react'

import {trpcReact} from './trpc'

export const TrpcProvider: React.FC<{children: React.ReactNode}> = ({children}) => {
	// https://tanstack.com/query/latest/docs/react/guides/important-defaults
	// Adding long staleTime to avoid unnecessary re-fetching
	const [queryClient] = useState(
		() =>
			new QueryClient({
				defaultOptions: {queries: {staleTime: 5000}},
			}),
	)

	const [trpcClient] = useState(() =>
		trpcReact.createClient({
			links: [
				loggerLink({
					enabled: () => true,
				}),
				httpBatchLink({
					url: `http://localhost:3001/trpc`,
					headers: async () => ({
						Authorization: `Bearer ${window.localStorage.getItem('jwt')}`,
					}),
				}),
			],
		}),
	)

	return (
		<trpcReact.Provider client={trpcClient} queryClient={queryClient}>
			<QueryClientProvider client={queryClient}>
				{children}
				<ReactQueryDevtools />
			</QueryClientProvider>
		</trpcReact.Provider>
	)
}
