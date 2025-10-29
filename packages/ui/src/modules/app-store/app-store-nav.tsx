import {compute} from 'compute-scroll-into-view'
import {useEffect, useRef} from 'react'
import {useParams} from 'react-router-dom'

import {FadeScroller} from '@/components/fade-scroller'
import {ButtonLink} from '@/components/ui/button-link'
import {useAvailableApps} from '@/providers/available-apps'
import {useBreakpoint} from '@/utils/tw'

import {categoryishDescriptions} from './constants'
import {getAllCategories, getCategoryLabel} from './utils'

export function ConnectedAppStoreNav() {
	const {categoryishId} = useParams<{categoryishId: string}>()
	const {appsGroupedByCategory} = useAvailableApps()

	// Get all categories (predefined + others from actual app data)
	const allCategories = getAllCategories(appsGroupedByCategory || {})

	// Filter to only show categories that have apps (plus discover/all)
	const categoriesWithApps = allCategories.filter((categoryId) => {
		// Always include 'discover' and 'all' regardless of app count
		if (categoryId === 'discover' || categoryId === 'all') return true
		// For other categories, only include if they have apps
		// A category may have no apps if it is a hardcoded one in the OS and we have changed the app manifests to no longer include it.
		return (appsGroupedByCategory as any)?.[categoryId]?.length > 0
	})

	const activeId: string = categoryishId || categoryishDescriptions[0].id

	return <AppStoreNav activeId={activeId} allCategories={categoriesWithApps} />
}

export function AppStoreNav({activeId, allCategories}: {activeId: string; allCategories: string[]}) {
	const scrollerRef = useRef<HTMLDivElement>(null)
	const scrollToRef = useRef<HTMLAnchorElement>(null)
	const breakpoint = useBreakpoint()
	const size = breakpoint === 'sm' ? 'default' : 'lg'

	// Alternative to: scrollToRef.current?.scrollIntoView({inline: 'center'})
	// `overflow: hidden` items in parents are scrolled, which breaks the UI.
	// Fixing scrolling issue by setting a boundary
	useEffect(() => {
		if (!scrollToRef.current) return
		const node = scrollToRef.current
		const actions = compute(node, {
			scrollMode: 'if-needed',
			inline: 'center',
			boundary: scrollerRef.current,
		})
		actions.forEach(({el, top, left}) => {
			el.scrollTop = top
			el.scrollLeft = left
		})
	}, [activeId])

	return (
		<FadeScroller
			ref={scrollerRef}
			direction='x'
			className='umbrel-hide-scrollbar -my-2 flex gap-[5px] overflow-x-auto py-2'
		>
			{allCategories.map((categoryId) => (
				<ButtonLink
					key={categoryId}
					to={categoryIdToPath(categoryId)}
					variant={categoryId === activeId ? 'secondary' : 'default'}
					ref={categoryId === activeId ? scrollToRef : undefined}
					size={size}
					unstable_viewTransition
				>
					{getCategoryLabel(categoryId)}
				</ButtonLink>
			))}
		</FadeScroller>
	)
}

function categoryIdToPath(categoryId: string) {
	if (categoryId === 'discover') {
		return '/app-store'
	}

	if (categoryId === 'all') {
		return '/app-store/category/all'
	}

	return `/app-store/category/${categoryId}`
}
