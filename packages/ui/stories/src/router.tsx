import One from '@stories/routes/demo/one'
import Two from '@stories/routes/demo/two'
import LoginTest from '@stories/routes/login-test'
import Stories from '@stories/routes/stories'
import {createBrowserRouter, Link} from 'react-router-dom'

import {ErrorBoundaryPageFallback} from '@/components/ui/error-boundary-page-fallback'
import {Demo} from '@/layouts/demo-layout'
import {linkClass} from '@/utils/element-classes'

import {SpecificStory, StoriesLayout} from './layout'

export const storiesRouter = createBrowserRouter([
	{
		path: '/',
		element: (
			<div className='flex flex-col'>
				<Link className={linkClass} to='/login'>
					Login/Logout
				</Link>
				<Link className={linkClass} to='/one'>
					Browser view transitions
				</Link>
				<Link className={linkClass} to='/stories'>
					Stories
				</Link>
			</div>
		),
	},
	{
		path: '/',
		Component: Demo,
		ErrorBoundary: ErrorBoundaryPageFallback,
		children: [
			{
				path: 'one',
				Component: One,
			},
			{
				path: 'two',
				Component: Two,
			},
		],
	},
	{
		path: 'login',
		Component: LoginTest,
	},
	// Keeping stories in subpath because sometimes we wanna test things without the main layout
	{
		path: '/',
		Component: StoriesLayout,
		ErrorBoundary: ErrorBoundaryPageFallback,
		children: [
			{
				path: 'stories',
				Component: Stories,
				index: true,
			},
			{
				path: 'stories/*',
				Component: SpecificStory,
			},
		],
	},
])
