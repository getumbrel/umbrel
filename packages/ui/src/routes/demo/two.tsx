import {Link} from 'react-router-dom'

export function Two() {
	return (
		<div>
			<h1 className='text-3xl font-bold text-blue-500 underline'>Two</h1>
			<Link to='/one' unstable_viewTransition>
				to Index
			</Link>
			<div
				id='box'
				className='relative left-10 top-10 h-64 w-64 bg-blue-500'
				style={{
					viewTransitionName: 'box',
				}}
			></div>
		</div>
	)
}
