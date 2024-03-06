import {useEffect} from 'react'
import {useLocation, useNavigation} from 'react-router-dom'
import {usePrevious} from 'react-use'

// TODO: Probably use this after it's merged:
// https://github.com/remix-run/react-router/pull/10468

/**
 * Given a ref to a scrolling container element, keep track of its scroll
 * position before navigation and restore it on return (e.g., back/forward nav).
 * Note that `location.pathname` is used in the cache key, not `location.key`. This means that query strings do not affect scroll restoration. This is mainly to avoid scrolling for the `dialog` query param.
 */
export function useScrollRestoration(container: React.RefObject<HTMLElement>) {
	const location = useLocation()
	const prevPathname = usePrevious(location.pathname)
	// Checking against settings for now because settings pages doesn't have subpages and app store does.
	// Settings page only has dialogs for now, but because they add to the history, each page transition automatically causes
	// a scroll to top. This is a workaround for that.
	// Always scroll to top for settings page itself, but don't do that for sub-pages
	const keyPart = location.pathname.startsWith('/settings') ? '/settings' : location.key
	const key = `scroll-position-${keyPart}`
	const {state} = useNavigation()

	useEffect(() => {
		const el = container.current
		const handleScrollEnd = () => {
			const y = Math.round(el?.scrollTop ?? 0)
			// console.log('scroll end', key, y ?? 0)
			setScrollPosition(key, y ?? 0)
		}
		// handleScrollEnd()

		// Add scrollend listener when supported in Safari
		// https://caniuse.com/?search=scrollend
		// el?.addEventListener('scrollend', handleScrollEnd)
		el?.addEventListener('scroll', handleScrollEnd)
		return () => {
			// el?.removeEventListener('scrollend', handleScrollEnd)
			el?.addEventListener('scroll', handleScrollEnd)
		}
	}, [container, key])

	useEffect(() => {
		if (state === 'idle') {
			// Always reset scroll to top if going to settings page from non-settings page
			if (location.pathname.startsWith('/settings') && !prevPathname?.startsWith('/settings')) {
				// Reset scroll position
				setScrollPosition(key, 0)
				container.current?.scrollTo(0, 0)
			} else {
				// This fails to go to the correct scroll position when you open a path like `/settings/2fa`.
				// Instead, goes to the top of the page. But if you close the dialog and then open the path again,
				// it goes to the correct scroll position. Happens in Safari, Chrome, and Firefox.
				// After lots of debugging, this appears to be an issue with `react-router-dom` and scroll containers within a page.
				// https://reactrouter.com/en/main/components/scroll-restoration
				// Using `preventScrollReset` in links and putting `<ScrollRestoration />` in the `Sheet` layout scroll container doesn't seem to do anything either.
				console.log('scrolling to', key, getScrollPosition(key))
				container.current?.scrollTo(0, getScrollPosition(key))
			}
		}
	}, [key, state, container, location.pathname, prevPathname])
}

function getScrollPosition(key: string) {
	const pos = window.sessionStorage.getItem(key)
	return pos && /^[0-9]+$/.test(pos) ? parseInt(pos, 10) : 0
}

function setScrollPosition(key: string, pos: number) {
	window.sessionStorage.setItem(key, pos.toString())
}
