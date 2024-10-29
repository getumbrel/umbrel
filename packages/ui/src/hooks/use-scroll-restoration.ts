import {useEffect} from 'react'
import {NavigationType, useLocation, useNavigation, useNavigationType} from 'react-router-dom'
import {usePrevious} from 'react-use'

/** Whether to restore, reset to zero or ignore scroll position. */
export type ScrollRestorationAction = 'restore' | 'reset' | 'ignore'

/**
 * Handler function testing if scroll position should be restored, reset to zero
 * or ignored.
 */
export type ScrollRestorationHandler = (
	thisPathname: string,
	prevPathname: string,
	navigationType: NavigationType,
) => ScrollRestorationAction

/**
 * Given a ref to a scrolling container element, keep track of its scroll
 * position before navigation and restore it on return (e.g., back/forward nav).
 * Behavior is determined by the provided {@link ScrollRestorationHandler}.
 */
export function useScrollRestoration(container: React.RefObject<HTMLElement>, handler: ScrollRestorationHandler) {
	const location = useLocation()
	const thisPathname = location.pathname
	const prevPathname = usePrevious(thisPathname)
	// `location.pathname` is used in the cache key, not `location.key`. This
	// means that query strings do not affect scroll restoration. This is mainly
	// to avoid scrolling for the `dialog` query param.
	const cacheKey = `scroll-position-${thisPathname}`
	const {state} = useNavigation()
	const navigationType = useNavigationType()

	useEffect(() => {
		const scrollElement = container.current
		if (state === 'idle') {
			if (!prevPathname) {
				// Clear cache when first entering a scroll restoration context
				clearScrollPositions()
			} else if (thisPathname !== prevPathname) {
				// Restore or reset cached scroll position where applicable
				const action = handler(thisPathname, prevPathname, navigationType)
				if (action === 'restore') {
					const y = getScrollPosition(cacheKey)
					scrollElement?.scrollTo(0, y)
					setScrollPosition(cacheKey, y)
				} else if (action === 'reset') {
					scrollElement?.scrollTo(0, 0)
					setScrollPosition(cacheKey, 0)
				} else {
					// ignore
				}
			}
		}

		// Cache last known scroll position. TODO: Use 'scrollend' listener when
		// supported in Safari: https://caniuse.com/?search=scrollend
		const handleScrollEnd = () => {
			const y = Math.round(scrollElement?.scrollTop ?? 0)
			setScrollPosition(cacheKey, y ?? 0)
		}
		scrollElement?.addEventListener('scroll' /*end*/, handleScrollEnd)
		return () => {
			scrollElement?.removeEventListener('scroll' /*end*/, handleScrollEnd)
		}
	}, [cacheKey, state, container, thisPathname, prevPathname, navigationType])
}

function getScrollPosition(key: string) {
	const pos = window.sessionStorage.getItem(key)
	return pos && /^[0-9]+$/.test(pos) ? parseInt(pos, 10) : 0
}

function setScrollPosition(key: string, pos: number) {
	if (pos) {
		window.sessionStorage.setItem(key, pos.toString())
	} else {
		window.sessionStorage.removeItem(key)
	}
}

function clearScrollPositions() {
	let index = 0
	while (index < window.sessionStorage.length) {
		const key = window.sessionStorage.key(index)
		if (key?.startsWith('scroll-position-')) {
			window.sessionStorage.removeItem(key)
		} else {
			index++
		}
	}
}
