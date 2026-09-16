import {useCallback, useDeferredValue, useEffect, useRef, useState} from 'react'
import {useSearchParams} from 'react-router-dom'

/**
 * Store search state: the input value, a deferred value driving the results,
 * `?q=` kept in sync so back-navigation returns to the results, and a global
 * '/' shortcut focusing the input.
 */
export function useStoreSearch() {
	const [searchParams, setSearchParams] = useSearchParams()
	const [query, setQuery] = useState(searchParams.get('q') ?? '')
	const deferredQuery = useDeferredValue(query)

	const activeInputRef = useRef<HTMLInputElement | null>(null)
	const setActiveInput = useCallback((input: HTMLInputElement | null) => {
		activeInputRef.current = input
	}, [])

	const writtenQuery = useRef(searchParams.get('q') ?? '')
	useEffect(() => {
		if (deferredQuery) searchParams.set('q', deferredQuery)
		else searchParams.delete('q')
		writtenQuery.current = deferredQuery
		setSearchParams(searchParams, {replace: true})
	}, [deferredQuery])

	// A search handed in from outside (Cmd+K's "More in App Store" while the
	// store is already open) replaces the field. Our own writes above come back
	// through the URL too; those are recognised and left alone.
	const urlQuery = searchParams.get('q') ?? ''
	useEffect(() => {
		if (urlQuery === writtenQuery.current) return
		writtenQuery.current = urlQuery
		setQuery(urlQuery)
	}, [urlQuery])

	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key !== '/') return
			const target = e.target as HTMLElement
			if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable)
				return
			e.preventDefault()
			activeInputRef.current?.focus()
		}
		window.addEventListener('keydown', handler)
		return () => window.removeEventListener('keydown', handler)
	}, [])

	return {query, deferredQuery, setQuery, setActiveInput}
}
