import React from 'react'
import {RouteObject} from 'react-router-dom'

import {ErrorBoundaryCardFallback} from '@/components/ui/error-boundary-card-fallback'
import {ErrorBoundaryPageFallback} from '@/components/ui/error-boundary-page-fallback'
import {EnsureLoggedIn} from '@/modules/auth/ensure-logged-in'
import {EnsureOwner} from '@/modules/auth/ensure-owner'

const MachinesLayout = React.lazy(() => import('@/features/machines'))
const MachinesIndex = React.lazy(() => import('@/features/machines/components/machines-index'))
const OsCatalog = React.lazy(() => import('@/features/machines/components/os-catalog'))
const CreateMachine = React.lazy(() => import('@/features/machines/components/create-machine'))
const MachineWindow = React.lazy(() => import('@/features/machines/components/machine-window'))
const MachineSettings = React.lazy(() => import('@/features/machines/components/machine-settings'))
const FullscreenConsole = React.lazy(() => import('@/features/machines/components/fullscreen-console'))

// Mounted inside the desktop layout (outside SheetLayout) so the Machines
// feature renders as an immersive overlay with the dock still visible.
// Machines are the owner's, so members are sent home.
export const machinesRoutes: RouteObject[] = [
	{
		path: 'machines',
		element: (
			<EnsureOwner>
				<MachinesLayout />
			</EnsureOwner>
		),
		ErrorBoundary: ErrorBoundaryCardFallback,
		children: [
			{
				index: true,
				element: <MachinesIndex />,
			},
			{
				path: 'new',
				element: <OsCatalog />,
			},
			{
				path: 'new/configure',
				element: <CreateMachine />,
			},
			{
				path: ':machineId',
				element: <MachineWindow />,
			},
			{
				path: ':machineId/settings',
				element: <MachineSettings />,
			},
		],
	},
]

// Top-level route (no desktop/dock chrome), opened in a new browser tab
export const machinesConsoleRoutes: RouteObject[] = [
	{
		path: 'machines/:machineId/fullscreen',
		element: (
			<EnsureLoggedIn>
				<EnsureOwner>
					<FullscreenConsole />
				</EnsureOwner>
			</EnsureLoggedIn>
		),
		ErrorBoundary: ErrorBoundaryPageFallback,
	},
]
