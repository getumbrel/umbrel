import {useCallback, useDeferredValue, useEffect, useRef, useState} from 'react'
import {useNavigationType, useSearchParams} from 'react-router-dom'

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

	// A fresh object each time: the one from useSearchParams is memoised on the
	// location, so mutating it would change urlQuery below before the
	// navigation has actually happened
	useEffect(() => {
		setSearchParams(
			(previous) => {
				const next = new URLSearchParams(previous)
				if (deferredQuery) next.set('q', deferredQuery)
				else next.delete('q')
				return next
			},
			{replace: true},
		)
	}, [deferredQuery])

	// A search handed in from outside (Cmd+K's "More in App Store" while the
	// store is already open) arrives as a push and replaces the field. The
	// writes above are the only replace navigations here, so those are left
	// alone: with two in flight the earlier can land after the later, and
	// adopting it would put a stale value back in the field and start a
	// ping-pong between the field and the URL.
	const urlQuery = searchParams.get('q') ?? ''
	const navigationType = useNavigationType()
	useEffect(() => {
		if (navigationType === 'REPLACE') return
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
