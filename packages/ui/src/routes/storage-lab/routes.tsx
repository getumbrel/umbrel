// Storage lab: throwaway routes for trying every FailSafe and Storage Manager screen on
// pretend hardware. The screens are the real ones from features/storage, and they need no login
// because nothing in them talks to umbreld.
//
// The lab exists in the dev server only. In a release build `import.meta.env.DEV` is the literal
// `false`, so the list below is empty, `labRoutes` is never called, and the bundler drops it
// together with every file it would have loaded. Keep the imports inside that function: at the
// top of the file they would be kept, and the lab would be built into the release as files
// nothing asks for.

import React, {Suspense} from 'react'
import type {RouteObject} from 'react-router-dom'

const page = (element: React.ReactNode) => <Suspense>{element}</Suspense>

function labRoutes(): RouteObject[] {
	const Index = React.lazy(() => import('./index'))
	const Onboarding = React.lazy(() => import('./onboarding'))
	const Manager = React.lazy(() => import('./manager'))
	const Map = React.lazy(() => import('./map'))
	const Notices = React.lazy(() => import('./notices'))
	const RealManager = React.lazy(() => import('./real'))
	const StartFailure = React.lazy(() => import('./other').then((module) => ({default: module.StartFailureLab})))
	const SingleDrive = React.lazy(() => import('./other').then((module) => ({default: module.SingleDriveLab})))
	return [
		{path: '/storage-lab', element: page(<Index />)},
		{path: '/storage-lab/map', element: page(<Map />)},
		{path: '/storage-lab/onboarding/:scenarioId', element: page(<Onboarding />)},
		{path: '/storage-lab/manager/:scenarioId', element: page(<Manager />)},
		{path: '/storage-lab/real/:scenarioId', element: page(<RealManager />)},
		{path: '/storage-lab/start/:device', element: page(<StartFailure />)},
		{path: '/storage-lab/single/:kind', element: page(<SingleDrive />)},
		{path: '/storage-lab/notices', element: page(<Notices />)},
	]
}

export const storageLabRoutes: RouteObject[] = import.meta.env.DEV ? labRoutes() : []
