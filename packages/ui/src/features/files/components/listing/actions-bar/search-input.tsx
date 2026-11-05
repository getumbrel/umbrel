import {useEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {RiCloseCircleFill} from 'react-icons/ri'
import {useLocation, useNavigate as useRouterNavigate, useSearchParams} from 'react-router-dom'

import {Input} from '@/components/ui/input'
import {SearchIcon} from '@/features/files/assets/search-icon'
import {BASE_ROUTE_PATH, SEARCH_PATH} from '@/features/files/constants'
import {useHomePath} from '@/features/files/hooks/use-home-path'
import {useIsTouchDevice} from '@/features/files/hooks/use-is-touch-device'
import {useNavigate as useFilesNavigate} from '@/features/files/hooks/use-navigate'
import {cn} from '@/lib/utils'
import {isBeneathModal} from '@/utils/is-beneath-modal'

// Search input with keyboard shortcuts:
// - "/" focuses the search input (keydown + preventDefault to avoid typing "/")
// - Escape and the X button (shown once something is typed) leave search:
//   they clear the query, blur the input and return to the directory the
//   search started from. That directory is remembered when the search begins;
//   when the search page was reached directly (a reload, a deep link) there is
//   nothing to remember and the home directory is used instead.
// - Query changes on the search page use replace:true, so typing doesn't push
//   a history entry per character.
// - Manually deleting all text does NOT auto-navigate away. This is intentional
//   so users can backspace and retype without being yanked out of search.
export function SearchInput() {
	const {t} = useTranslation()
	const navigate = useRouterNavigate()
	const location = useLocation()
	const inputRef = useRef<HTMLInputElement>(null)

	const [searchParams] = useSearchParams()

	const [query, setQuery] = useState('')

	const isTouchDevice = useIsTouchDevice()
	const {currentPath, navigateToDirectory} = useFilesNavigate()
	const homePath = useHomePath()
	const inSearch = location.pathname.endsWith(SEARCH_PATH)
	const returnPathRef = useRef<string | null>(null)

	// "/" shortcut to focus the search input
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key !== '/') return
			const target = e.target as HTMLElement
			if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable)
				return
			if (isBeneathModal(inputRef.current, e)) return
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
		if (!inSearch) returnPathRef.current = currentPath
		gotoSearch(trimmed, {replace: inSearch})
	}

	const exitSearch = () => {
		setQuery('')
		inputRef.current?.blur()
		if (inSearch) navigateToDirectory(returnPathRef.current ?? homePath)
	}

	return (
		<div className='relative rounded-full focus-within:border-1 focus-within:border-neutral-600 focus-within:border-white/20 lg:border-[0.5px] lg:border-neutral-800 lg:border-white/6 lg:bg-white/5 lg:shadow-button-highlight-soft-hpx lg:ring-white/6 lg:focus-within:bg-white/10'>
			<Input
				className={cn(
					'h-7 w-0 !border-none !bg-transparent px-4 text-xs !ring-0 !outline-hidden transition-all duration-300 focus:w-[calc(100vw-11rem)] focus:pl-8 lg:w-28 lg:pr-0 lg:pl-8 lg:focus:w-36 panes:focus:w-52 phone-side:focus:w-52',
					{
						'w-[calc(100vw-11rem)] pr-7 pl-8 lg:w-36 lg:pr-7 panes:w-52 phone-side:w-52': query.length > 0,
					},
				)}
				ref={inputRef}
				placeholder={t('files-search.placeholder')}
				value={query}
				onChange={onQueryChange}
				onKeyDown={(e) => {
					if (e.key === 'Escape') exitSearch()
				}}
			/>
			<SearchIcon
				className='absolute top-1/2 left-2 h-4 w-4 -translate-y-1/2 transform cursor-text text-neutral-500'
				onClick={() => inputRef.current?.focus()}
			/>
			{query.length > 0 && (
				<button
					type='button'
					aria-label={t('files-search.exit')}
					onPointerDown={(e) => e.preventDefault()}
					onClick={exitSearch}
					className='absolute top-1/2 right-2 -translate-y-1/2 text-neutral-500 outline-hidden transition-colors hover:text-white focus-visible:text-white'
				>
					<RiCloseCircleFill className='h-4 w-4' />
				</button>
			)}
		</div>
	)
}
