import {useEffect, useRef, useState} from 'react'
import {useLocation, useNavigate as useRouterNavigate, useSearchParams} from 'react-router-dom'

import {SearchIcon} from '@/features/files/assets/search-icon'
import {BASE_ROUTE_PATH, SEARCH_PATH} from '@/features/files/constants'
import {useIsTouchDevice} from '@/features/files/hooks/use-is-touch-device'
import {Input} from '@/shadcn-components/ui/input'
import {cn} from '@/shadcn-lib/utils'
import {t} from '@/utils/i18n'

export function SearchInput() {
	const navigate = useRouterNavigate()
	const location = useLocation()
	const inputRef = useRef<HTMLInputElement>(null)

	const [searchParams] = useSearchParams()

	const [query, setQuery] = useState('')

	const isTouchDevice = useIsTouchDevice()

	// sync local state with the URL when navigating into the search route via
	// back/forward browser buttons or a browser refresh, or programmatic
	// navigation from anywhere
	useEffect(() => {
		if (location.pathname.endsWith(SEARCH_PATH)) {
			// when on the search route we want the input to reflect the query param
			setQuery(searchParams.get('q') ?? '')
			// focus the input on non-touch devices
			if (!isTouchDevice) {
				inputRef.current?.focus()
			}
		} else {
			// when not on the search route we want to clear the input
			setQuery('')
		}
	}, [location.pathname, searchParams])

	// helper to push/replace the appropriate route for a given query
	const gotoSearch = (query: string, {replace}: {replace: boolean}) => {
		const encodedQuery = encodeURIComponent(query.trim())
		navigate(`${BASE_ROUTE_PATH}${SEARCH_PATH}?q=${encodedQuery}`, {replace})
	}

	const onQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const next = e.target.value
		setQuery(next)

		const trimmed = next.trim()

		// avoid navigating for empty queries – we'll stay on the current
		// directory (or the existing search page showing previous results).
		if (trimmed === '') return
		const currentlyOnSearchPage = location.pathname.endsWith(SEARCH_PATH)
		gotoSearch(trimmed, {replace: currentlyOnSearchPage})
	}

	return (
		<div className='focus-within:border-1 relative rounded-full focus-within:border-neutral-600 focus-within:border-white/20 md:border-[0.5px] md:border-neutral-800 md:border-white/6 md:bg-white/5 md:shadow-button-highlight-soft-hpx md:ring-white/6 md:focus-within:bg-white/10'>
			<Input
				className={cn(
					'h-7 w-0 !border-none !bg-transparent px-4 text-xs !outline-none !ring-0 transition-all duration-300 focus:w-[calc(100vw-11rem)] focus:pl-8 md:w-28 md:pl-8 md:pr-0 md:focus:w-36',
					{
						'w-[calc(100vw-11rem)] pl-8 md:w-36': query.length > 0,
					},
				)}
				ref={inputRef}
				placeholder={t('files-search.placeholder')}
				value={query}
				onChange={onQueryChange}
				// clear and blur the input on Escape
				onKeyDown={(e) => {
					if (e.key === 'Escape') {
						setQuery('')
						inputRef.current?.blur()
					}
				}}
			/>
			<SearchIcon
				className='absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 transform cursor-text text-neutral-500'
				onClick={() => inputRef.current?.focus()}
			/>
		</div>
	)
}
