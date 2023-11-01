import {useParams} from 'react-router-dom'

import {LinkButton} from '@/components/ui/link-button'
import {Category} from '@/trpc/trpc'

import {categoryishDescriptions} from './constants'

export function AppStoreNav() {
	const {categoryishId} = useParams<{categoryishId: Category}>()

	const activeId = categoryishId || categoryishDescriptions[0].id

	return (
		<>
			<div className='umbrel-hide-scrollbar umbrel-fade-scroller-x -my-2 flex gap-[5px] overflow-x-auto py-2'>
				{categoryishDescriptions.map((category) => (
					<LinkButton
						key={category.id}
						to={categoryIdToPath(category.id)}
						variant={category.id === activeId ? 'primary' : 'default'}
						size='lg'
						unstable_viewTransition
					>
						{category.label}
					</LinkButton>
				))}
			</div>
		</>
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
