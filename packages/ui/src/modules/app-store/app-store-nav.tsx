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
	const scrollToRef = useRef<HTMLAnchorElement>(null)
	const breakpoint = useBreakpoint()
	const size = breakpoint === 'sm' ? 'default' : 'lg'

	useEffect(() => {
		scrollToRef.current?.scrollIntoView({inline: 'center'})
	}, [])

	return (
		<FadeScroller
			direction='x'
			className='umbrel-hide-scrollbar -my-2 flex snap-x snap-mandatory gap-[5px] overflow-x-auto py-2'
		>
			{categoryishDescriptions.map((category) => (
				<ButtonLink
					key={category.id}
					to={categoryIdToPath(category.id)}
					variant={category.id === activeId ? 'primary' : 'default'}
					ref={category.id === activeId ? scrollToRef : undefined}
					size={size}
					className='snap-center'
					unstable_viewTransition
				>
					{category.label}
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
