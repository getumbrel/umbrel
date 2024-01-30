import {useParams} from 'react-router-dom'

import {FadeScroller} from '@/components/fade-scroller'
import {ButtonLink} from '@/components/ui/button-link'
import {Category} from '@/trpc/trpc'
import {useBreakpoint} from '@/utils/tw'

import {categoryishDescriptions} from './constants'

export function AppStoreNav() {
	const {categoryishId} = useParams<{categoryishId: Category}>()
	const breakpoint = useBreakpoint()
	const size = breakpoint === 'sm' ? 'default' : 'lg'

	const activeId = categoryishId || categoryishDescriptions[0].id

	return (
		<FadeScroller direction='x' className='umbrel-hide-scrollbar -my-2 flex gap-[5px] overflow-x-auto py-2'>
			{categoryishDescriptions.map((category) => (
				<ButtonLink
					key={category.id}
					to={categoryIdToPath(category.id)}
					variant={category.id === activeId ? 'primary' : 'default'}
					size={size}
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
