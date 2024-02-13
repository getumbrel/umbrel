import {compute} from 'compute-scroll-into-view'
import {useEffect, useRef} from 'react'
import {useParams} from 'react-router-dom'

import {FadeScroller} from '@/components/fade-scroller'
import {ButtonLink} from '@/components/ui/button-link'
import {useBreakpoint} from '@/utils/tw'

import {Category, Categoryish, categoryishDescriptions} from './constants'

export function ConnectedAppStoreNav() {
	const {categoryishId} = useParams<{categoryishId: Category}>()
	const activeId: Categoryish = categoryishId || categoryishDescriptions[0].id

	return <AppStoreNav activeId={activeId} />
}

export function AppStoreNav({activeId}: {activeId: Categoryish}) {
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
			{categoryishDescriptions.map((category) => (
				<ButtonLink
					key={category.id}
					to={categoryIdToPath(category.id)}
					variant={category.id === activeId ? 'primary' : 'default'}
					ref={category.id === activeId ? scrollToRef : undefined}
					size={size}
					unstable_viewTransition
				>
					{category.label()}
				</ButtonLink>
			))}
		</FadeScroller>
	)
}

function categoryIdToPath(categoryId: Category | 'all' | 'discover') {
	if (categoryId === 'discover') {
		return '/app-store'
	}

	if (categoryId === 'all') {
		return '/app-store/category/all'
	}

	return `/app-store/category/${categoryId}`
}
