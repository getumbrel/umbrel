import {useParams} from 'react-router-dom'

import {LinkButton} from '@/components/ui/link-button'
import {Category} from '@/trpc/trpc'

const categoryDescriptions = [
	{id: 'discover', label: 'Discover'},
	{id: 'all', label: 'All'},
	{id: 'files', label: 'Files'},
	{id: 'bitcoin', label: 'Bitcoin'},
	{id: 'media', label: 'Media'},
	{id: 'networking', label: 'Networking'},
	{id: 'social', label: 'Social'},
	{id: 'automation', label: 'Automation'},
	{id: 'finance', label: 'Finance'},
	{id: 'ai', label: 'AI'},
	{id: 'developer', label: 'Developer'},
] as const satisfies readonly {id: Category | 'all' | 'discover'; label: string}[]

export function AppStoreNav() {
	const {categoryId} = useParams<{categoryId: Category}>()

	const activeId = categoryId || categoryDescriptions[0].id

	return (
		<>
			<div className='umbrel-hide-scrollbar umbrel-fade-scroller-x -my-2 flex gap-[5px] overflow-x-auto py-2'>
				{categoryDescriptions.map((category) => (
					<LinkButton
						key={category.id}
						to={categoryIdToPath(category.id)}
						variant={category.id === activeId ? 'primary' : 'default'}
						size='lg'
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
