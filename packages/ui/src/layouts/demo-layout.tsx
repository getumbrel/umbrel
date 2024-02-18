import {Suspense} from 'react'
import {Outlet} from 'react-router-dom'

export function Demo() {
	return (
		<Suspense>
			<Outlet />
		</Suspense>
	)
}
