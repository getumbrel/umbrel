import {useEffect, useRef, useState} from 'react'
import {useLocation, useNavigate as useRouterNavigate, useSearchParams} from 'react-router-dom'

import {Input} from '@/components/ui/input'
import {SearchIcon} from '@/features/files/assets/search-icon'
import {BASE_ROUTE_PATH, SEARCH_PATH} from '@/features/files/constants'
import {useIsTouchDevice} from '@/features/files/hooks/use-is-touch-device'
import {cn} from '@/lib/utils'
import {t} from '@/utils/i18n'

// Search input with keyboard shortcuts:
// - "/" focuses the search input (keydown + preventDefault to avoid typing "/")
// - Escape exits search entirely: clears the query, blurs the input, and
//   navigates back to the previous directory. This works because query changes
//   on the search page use replace:true, so only the initial entry into search
//   pushes a history entry — a single navigate(-1) always returns to the
//   pre-search directory.
// - Manually deleting all text does NOT auto-navigate away. This is intentional
//   so users can backspace and retype without being yanked out of search.
//   They can use Escape or the nav arrows to leave.
export function SearchInput() {
	const navigate = useRouterNavigate()
	const location = useLocation()
	const inputRef = useRef<HTMLInputElement>(null)

	const [searchParams] = useSearchParams()

	const [query, setQuery] = useState('')

	const isTouchDevice = useIsTouchDevice()

	// "/" shortcut to focus the search input
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key !== '/') return
			const target = e.target as HTMLElement
			if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable)
				return
			e.preventDefault()
			inputRef.current?.focus()
		}
		window.addEventListener('keydown', handleKeyDown)
		return () => window.removeEventListener('keydown', handleKeyDown)
	}, [])

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
		<div className='relative rounded-full focus-within:border-1 focus-within:border-neutral-600 focus-within:border-white/20 md:border-[0.5px] md:border-neutral-800 md:border-white/6 md:bg-white/5 md:shadow-button-highlight-soft-hpx md:ring-white/6 md:focus-within:bg-white/10'>
			<Input
				className={cn(
					'h-7 w-0 !border-none !bg-transparent px-4 text-xs !ring-0 !outline-hidden transition-all duration-300 focus:w-[calc(100vw-11rem)] focus:pl-8 md:w-28 md:pr-0 md:pl-8 md:focus:w-36',
					{
						'w-[calc(100vw-11rem)] pl-8 md:w-36': query.length > 0,
					},
				)}
				ref={inputRef}
				placeholder={t('files-search.placeholder')}
				value={query}
				onChange={onQueryChange}
				// Escape exits search: clear query, blur input, navigate back to previous directory
				onKeyDown={(e) => {
					if (e.key === 'Escape') {
						setQuery('')
						inputRef.current?.blur()
						if (location.pathname.endsWith(SEARCH_PATH)) {
							navigate(-1)
						}
					}
				}}
			/>
			<SearchIcon
				className='absolute top-1/2 left-2 h-4 w-4 -translate-y-1/2 transform cursor-text text-neutral-500'
				onClick={() => inputRef.current?.focus()}
			/>
		</div>
	)
}
