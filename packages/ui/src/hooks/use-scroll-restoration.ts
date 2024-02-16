import {useEffect} from 'react'
import {useLocation, useNavigation} from 'react-router-dom'

// TODO: Probably use this after it's merged:
// https://github.com/remix-run/react-router/pull/10468

/**
 * Given a ref to a scrolling container element, keep track of its scroll
 * position before navigation and restore it on return (e.g., back/forward nav).
 * Note that `location.pathname` is used in the cache key, not `location.key`. This means that query strings do not affect scroll restoration. This is mainly to avoid scrolling for the `dialog` query param.
 */
export function useScrollRestoration(container: React.RefObject<HTMLElement>) {
	const location = useLocation()
	// Checking against settings for now because settings pages doesn't have subpages and app store does.
	// Settings page only has dialogs for now, but because they add to the history, each page transition automatically causes
	// a scroll to top. This is a workaround for that.
	const keyPart = location.pathname === '/settings' ? location.pathname : location.key
	const key = `scroll-position-${keyPart}`
	const {state} = useNavigation()

	useEffect(() => {
		const el = container.current
		const handleScrollEnd = () => {
			const y = Math.round(el?.scrollTop ?? 0)
			console.log('scroll end', key, y ?? 0)
			setScrollPosition(key, y ?? 0)
		}
		el?.addEventListener('scrollend', handleScrollEnd)
		return () => {
			el?.removeEventListener('scrollend', handleScrollEnd)
		}
	}, [container, key])

	useEffect(() => {
		if (state === 'idle') {
			console.log('scrolling to', key, getScrollPosition(key))
			container.current?.scrollTo(0, getScrollPosition(key))
		}
	}, [key, state, container])
}

function getScrollPosition(key: string) {
	const pos = window.sessionStorage.getItem(key)
	return pos && /^[0-9]+$/.test(pos) ? parseInt(pos, 10) : 0
}

function setScrollPosition(key: string, pos: number) {
	window.sessionStorage.setItem(key, pos.toString())
}
