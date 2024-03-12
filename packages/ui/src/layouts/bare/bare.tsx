import {Suspense} from 'react'
import {Outlet} from 'react-router-dom'

import {BarePage} from '@/layouts/bare/bare-page'

export function BareLayout() {
	return (
		<BarePage>
			<Suspense>
				<Outlet />
			</Suspense>
		</BarePage>
	)
}
