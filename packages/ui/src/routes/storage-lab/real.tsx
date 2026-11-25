// Storage lab: the real Storage Manager from Settings, on a pretend umbreld. Nothing here is a
// mock of the screen: it is the component Settings mounts, with its own reading of umbreld's
// status, its own requests and its own handling of umbreld's events. Only umbreld is pretend,
// and it answers in umbreld's own shapes (see umbreld.ts).

import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {useEffect, useMemo, useState, useSyncExternalStore} from 'react'
import {useNavigate, useParams} from 'react-router-dom'

import {OnboardingBackground} from '@/components/onboarding-background'
import {ConnectedStorageManager} from '@/features/storage/index'
import {PendingRaidOperationProvider} from '@/features/storage/providers/pending-operation-context'
import {viewPool} from '@/features/storage/state'
import {ImmersiveDialogProvider} from '@/providers/immersive-dialog'
import {trpcReact} from '@/trpc/trpc'

import {LabBar, labButtonClass} from './chrome'
import {managerScenarios} from './fixtures'
import {Brand, RestartCover, SimulateMenu, useBrandColour} from './manager'
import {createPretendUmbreld} from './umbreld'

const RESTART_MS = 3600

export default function RealManagerLab() {
	const {scenarioId} = useParams()
	// Each scenario gets an umbreld of its own
	return <RealManager key={scenarioId} />
}

function RealManager() {
	const {scenarioId} = useParams()
	const navigate = useNavigate()
	const scenario = managerScenarios.find((candidate) => candidate.id === scenarioId) ?? managerScenarios[0]
	const {umbreld, client, queries} = useMemo(() => {
		const pretend = createPretendUmbreld(scenario.build(), {usb: scenario.usb})
		return {
			umbreld: pretend,
			client: trpcReact.createClient({links: [pretend.link]}),
			queries: new QueryClient({defaultOptions: {queries: {retry: false}}}),
		}
	}, [scenario])
	const sim = useSyncExternalStore(umbreld.watch, () => umbreld.sim)
	const refusing = useSyncExternalStore(umbreld.watch, () => umbreld.refusing)
	// A scenario that opens mid-task stays frozen until asked, so it can be looked at
	const [running, setRunning] = useState(!sim.op)
	const [menuOpen, setMenuOpen] = useState(false)
	const [notice, setNotice] = useState<string | null>(null)
	const [brand, setBrand] = useState<Brand>('default')
	const restarting = sim.op?.kind === 'failsafe' && sim.op.phase === 'restarting'
	useBrandColour(brand)

	useEffect(() => {
		if (!sim.op || !running || restarting) return
		const timer = setInterval(() => umbreld.dispatch({type: 'tick', amount: 0.55}), 110)
		return () => clearInterval(timer)
	}, [!!sim.op, running, restarting, umbreld])

	useEffect(() => {
		if (!restarting || !running) return
		const timer = setTimeout(() => umbreld.restart(), RESTART_MS)
		return () => clearTimeout(timer)
	}, [restarting, running, umbreld])

	useEffect(() => {
		if (!notice) return
		const timer = setTimeout(() => setNotice(null), 2600)
		return () => clearTimeout(timer)
	}, [notice])

	return (
		<trpcReact.Provider client={client} queryClient={queries}>
			<QueryClientProvider client={queries}>
				<PendingRaidOperationProvider>
					<ImmersiveDialogProvider>
						<OnboardingBackground />
						<ConnectedStorageManager
							onShutdown={() => setNotice('Your Umbrel would shut down here.')}
							onRestart={() => setNotice('Your Umbrel would restart here.')}
						/>
						{restarting && <RestartCover />}
						{notice && (
							<div
								role='status'
								className='pointer-events-none fixed inset-x-0 bottom-16 z-[90] flex justify-center px-4 md:bottom-6'
							>
								<span className='rounded-full border border-white/15 bg-black/85 px-4 py-2 text-13 text-white/85 shadow-xl backdrop-blur-md'>
									{notice}
								</span>
							</div>
						)}
						<LabBar title={`Real Storage Manager · ${scenario.title}`}>
							{sim.op && (
								<>
									<button type='button' className={labButtonClass} onClick={() => setRunning((value) => !value)}>
										{running ? 'Pause' : 'Play'}
									</button>
									<button
										type='button'
										className={labButtonClass}
										onClick={() => {
											umbreld.dispatch({type: 'finish'})
											setRunning(true)
										}}
									>
										Skip to the end
									</button>
								</>
							)}
							<button type='button' className={labButtonClass} onClick={() => setMenuOpen((value) => !value)}>
								Simulate
							</button>
							<button
								type='button'
								className={labButtonClass}
								onClick={() => navigate(`/storage-lab/manager/${scenario.id}`)}
							>
								Screen only
							</button>
						</LabBar>
						{menuOpen && (
							<SimulateMenu
								sim={sim}
								view={viewPool(sim)}
								dispatch={umbreld.dispatch}
								refusing={refusing}
								onRefusing={umbreld.setRefusing}
								brand={brand}
								onBrand={setBrand}
								onReset={() => {
									umbreld.dispatch({type: 'set', sim: scenario.build()})
									setRunning(false)
								}}
								onClose={() => setMenuOpen(false)}
							/>
						)}
					</ImmersiveDialogProvider>
				</PendingRaidOperationProvider>
			</QueryClientProvider>
		</trpcReact.Provider>
	)
}
