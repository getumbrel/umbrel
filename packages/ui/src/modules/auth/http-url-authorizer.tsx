import {createContext, useCallback, useContext, type ReactNode} from 'react'

import {authorizedUrlState} from '@/modules/auth/authorized-url'
import {trpcReact} from '@/trpc/trpc'

type Authorize = (url: string | undefined) => string | undefined

const HttpUrlAuthorizerContext = createContext<Authorize | null>(null)

// One token query shared by every authorized URL beneath it. A list that
// mounts hundreds of <img>s at once (the Photos grid at a new zoom stop) must
// not subscribe each of them to the token query — the observers alone took
// longer than the reflow they were mounted for.
export function HttpUrlAuthorizerProvider({children}: {children: ReactNode}) {
	const tokenQuery = trpcReact.user.getHttpApiToken.useQuery(undefined, {
		staleTime: Infinity,
		refetchOnWindowFocus: false,
	})
	const token = tokenQuery.data
	const failed = tokenQuery.isError
	const authorize = useCallback<Authorize>((url) => authorizedUrlState(url, token, failed).url, [token, failed])
	return <HttpUrlAuthorizerContext value={authorize}>{children}</HttpUrlAuthorizerContext>
}

// The provider above if there is one, its own otherwise — for a component
// that draws authorized URLs wherever it is dropped (a Files icon: listings
// of hundreds, and one-off dialogs alike). Surfaces that mount many of them
// put one provider above the lot; the stragglers still work.
export function EnsureHttpUrlAuthorizer({children}: {children: ReactNode}) {
	return useContext(HttpUrlAuthorizerContext) ? (
		children
	) : (
		<HttpUrlAuthorizerProvider>{children}</HttpUrlAuthorizerProvider>
	)
}

// The authorizer itself, for callers holding many URLs at once — the Photos
// canvas asks for thousands and cannot mount a hook per tile
export function useHttpUrlAuthorizer() {
	const authorize = useContext(HttpUrlAuthorizerContext)
	if (!authorize) throw new Error('useHttpUrlAuthorizer must be used within <HttpUrlAuthorizerProvider />')
	return authorize
}

// `useAuthorizedHttpUrl` without a query per caller; needs the provider above
export function useSharedAuthorizedHttpUrl(url: string | undefined) {
	return useHttpUrlAuthorizer()(url)
}
