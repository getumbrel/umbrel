import {useParams} from 'react-router-dom'

import {AppStoreNav} from '@/modules/app-store/app-store-nav'

export function CategoryPage() {
	const {categoryId} = useParams()

	return (
		<>
			<AppStoreNav />
			<div>Category ID: {categoryId}</div>
		</>
	)
}
