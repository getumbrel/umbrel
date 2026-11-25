import {createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode} from 'react'
import {useLocation, useNavigate as useRouterNavigate, useSearchParams} from 'react-router-dom'

import {BASE_ROUTE_PATH, SEARCH_PATH} from '@/features/files/constants'
import {useHomePath} from '@/features/files/hooks/use-home-path'
import {useNavigate as useFilesNavigate} from '@/features/files/hooks/use-navigate'

type FilesSearch = {
	// What is typed in the field
	query: string
	setQuery: (query: string) => void
	// The field has the stage: focused on a desktop, up in the title row on a phone
	open: boolean
	setOpen: (open: boolean) => void
	// The field is wide and the bar's other controls stand aside: while it is
	// open, holds text or its results are on screen
	engaged: boolean
	// Clears the search and goes back to where it began
	exit: () => void
}

const FilesSearchContext = createContext<FilesSearch | undefined>(undefined)

// The Files search, shared by the bar's pill and the phone's title row.
// - Typing goes to the search route, where the listing is the results. The
//   query lives in the URL, so the browser's Back returns to them from a
//   folder opened out of them.
// - Query changes on the search page use replace:true, so typing doesn't push
//   a history entry per character.
// - Leaving (Escape, the field's ×, Cancel) clears it and returns to the
//   folder the search started in. That folder is remembered when the search
//   begins; reached directly (a reload, a deep link) there is nothing to
//   remember, and the home folder is used instead.
// - Deleting all the text does NOT leave. This is intentional, so users can
//   backspace and retype without being yanked out of search.
export function FilesSearchProvider({children}: {children: ReactNode}) {
	const navigate = useRouterNavigate()
	const location = useLocation()
	const [searchParams] = useSearchParams()
	const {currentPath, navigateToDirectory} = useFilesNavigate()
	const homePath = useHomePath()

	const [query, setQueryState] = useState('')
	const [open, setOpen] = useState(false)
	const inSearch = location.pathname === `${BASE_ROUTE_PATH}${SEARCH_PATH}`
	const returnPathRef = useRef<string | null>(null)

	// Follow the URL: into the search route through back/forward, a refresh or
	// a link from elsewhere the field shows its query; out of it, it empties
	const urlQuery = searchParams.get('q') ?? ''
	useEffect(() => {
		setQueryState(inSearch ? urlQuery : '')
		// A folder opened from the results is not a search any more
		if (!inSearch) setOpen(false)
	}, [inSearch, urlQuery])

	const value = useMemo<FilesSearch>(() => {
		const setQuery = (next: string) => {
			setQueryState(next)
			const trimmed = next.trim()
			// An empty field stays where it is: the folder, or the last results
			if (trimmed === '') return
			if (!inSearch) returnPathRef.current = currentPath
			navigate(`${BASE_ROUTE_PATH}${SEARCH_PATH}?q=${encodeURIComponent(trimmed)}`, {replace: inSearch})
		}
		const exit = () => {
			setQueryState('')
			setOpen(false)
			if (inSearch) navigateToDirectory(returnPathRef.current ?? homePath)
		}
		return {query, setQuery, open, setOpen, engaged: open || query !== '' || inSearch, exit}
	}, [query, open, inSearch, currentPath, homePath, navigate, navigateToDirectory])

	return <FilesSearchContext value={value}>{children}</FilesSearchContext>
}

// Undefined where Files has no search: embedded in Rewind, which has no router of its own to search through
export function useFilesSearch() {
	return useContext(FilesSearchContext)
}

export function useFilesSearchEngaged() {
	return useContext(FilesSearchContext)?.engaged ?? false
}
