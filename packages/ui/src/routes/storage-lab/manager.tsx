// Storage lab: Storage Manager on a pretend storage. The window and everything in it is the
// real one from features/storage. The lab gives it a state, takes its requests, and lets
// the Simulate menu do what only hardware can: fail a drive, pull one out, plug one in.

import {useEffect, useMemo, useReducer, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {useLocation, useNavigate, useParams} from 'react-router-dom'

import {OnboardingBackground} from '@/components/onboarding-background'
import {Loading} from '@/components/ui/loading'
import {StorageManager} from '@/features/storage/manager/manager'
import {Drive, formatSize, troubleOf} from '@/features/storage/model'
import {Member, PoolView, StorageAction, viewPool} from '@/features/storage/state'
import {cn} from '@/lib/utils'
import {ImmersiveDialogProvider} from '@/providers/immersive-dialog'

import {LabBar, labButtonClass, labChipClass, LabChips, LabGroup, LabPanel} from './chrome'
import {conditions as driveConditions, managerScenarios, sizesTb, usbDrives} from './fixtures'
import {request, restarted, Sim, SimEvent, simReducer} from './sim'

export default function ManagerLab() {
	const {scenarioId} = useParams()
	const location = useLocation()
	// Each scenario, and each arrival from onboarding, starts from its own state
	return <Manager key={`${scenarioId}-${location.key}`} />
}

export const brands = [
	{id: 'default', label: 'Default', value: ''},
	{id: 'red', label: 'Red', value: '359 64% 62%'},
	{id: 'amber', label: 'Amber', value: '32 100% 36%'},
	{id: 'teal', label: 'Teal', value: '174 75% 32%'},
] as const
export type Brand = (typeof brands)[number]['id']

// The wallpaper sets the brand colour. No state of the storage may depend on it.
export function useBrandColour(brand: Brand) {
	useEffect(() => {
		const value = brands.find((option) => option.id === brand)?.value
		if (!value) return
		const root = document.documentElement
		const original = root.style.getPropertyValue('--color-brand')
		root.style.setProperty('--color-brand', value)
		return () => {
			root.style.setProperty('--color-brand', original)
		}
	}, [brand])
}

// How long the pretend umbreld takes to answer a request, and to restart
const ANSWER_MS = 900
const RESTART_MS = 3600

function Manager() {
	const {scenarioId} = useParams()
	const location = useLocation()
	const navigate = useNavigate()
	const scenario = managerScenarios.find((candidate) => candidate.id === scenarioId)
	const carried = (location.state as {sim?: Sim} | null)?.sim
	const initial = useMemo(
		() => carried ?? scenario?.build() ?? managerScenarios[0].build(),
		// Built once per scenario: the simulation owns the state from there on
		[scenarioId],
	)
	const [sim, dispatch] = useReducer(simReducer, initial)
	const latest = useRef(sim)
	latest.current = sim
	// A scenario that opens mid-task stays frozen until asked, so it can be looked at
	const [running, setRunning] = useState(!initial.op)
	const [menuOpen, setMenuOpen] = useState(false)
	const [refusing, setRefusing] = useState(false)
	const [notice, setNotice] = useState<string | null>(null)
	const [brand, setBrand] = useState<Brand>('default')
	const view = viewPool(sim)
	const restarting = sim.op?.kind === 'failsafe' && sim.op.phase === 'restarting'

	useEffect(() => {
		if (!sim.op || !running || restarting) return
		const timer = setInterval(() => dispatch({type: 'tick', amount: 0.55}), 110)
		return () => clearInterval(timer)
	}, [!!sim.op, running, restarting])

	// umbrelOS is gone for the restart, and comes back with the new drives as its storage
	useEffect(() => {
		if (!restarting || !running) return
		const timer = setTimeout(() => dispatch({type: 'set', sim: restarted(latest.current)}), RESTART_MS)
		return () => clearTimeout(timer)
	}, [restarting, running])

	useBrandColour(brand)

	useEffect(() => {
		if (!notice) return
		const timer = setTimeout(() => setNotice(null), 2600)
		return () => clearTimeout(timer)
	}, [notice])

	// What the screens ask for takes a moment, and can be refused
	const run = async (action: StorageAction) => {
		await new Promise((resolve) => setTimeout(resolve, ANSWER_MS))
		if (refusing) {
			setRefusing(false)
			throw new Error('Command failed with exit code 1: zpool: cannot open ‘umbrelos’: pool I/O is currently suspended')
		}
		dispatch({type: 'set', sim: request(latest.current, action)})
		setRunning(true)
	}

	return (
		<ImmersiveDialogProvider>
			<OnboardingBackground />
			<StorageManager
				state={sim}
				run={run}
				onClose={() => navigate('/storage-lab')}
				onShutdown={() => setNotice('Your Umbrel would shut down here.')}
				onRestart={() => setNotice('Your Umbrel would restart here.')}
				onOpenBackups={() => setNotice('Backups would open here.')}
				usb={scenario?.usb ? {drives: usbDrives, onOpenFiles: () => setNotice('Files would open here.')} : undefined}
				recommendedSsdSize='512GB'
				supportUrl='https://umbrel.com/support'
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

			<LabBar title={carried ? 'From your onboarding' : scenario ? scenario.title : 'Storage Manager'}>
				{sim.op && (
					<>
						<button type='button' className={labButtonClass} onClick={() => setRunning((value) => !value)}>
							{running ? 'Pause' : 'Play'}
						</button>
						<button
							type='button'
							className={labButtonClass}
							onClick={() => {
								dispatch({type: 'finish'})
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
				{scenario && !carried && (
					<button type='button' className={labButtonClass} onClick={() => navigate(`/storage-lab/real/${scenario.id}`)}>
						Through umbreld
					</button>
				)}
			</LabBar>
			{menuOpen && (
				<SimulateMenu
					sim={sim}
					view={view}
					dispatch={dispatch}
					refusing={refusing}
					onRefusing={setRefusing}
					brand={brand}
					onBrand={setBrand}
					onReset={() => {
						dispatch({type: 'set', sim: initial})
						setRunning(!initial.op)
					}}
					onClose={() => setMenuOpen(false)}
				/>
			)}
		</ImmersiveDialogProvider>
	)
}

// What umbrelOS shows while it restarts, with the reason on it: nobody asked for this
// restart, and it can come hours after the switch was started
export function RestartCover() {
	const {t} = useTranslation()
	return (
		<div
			role='status'
			className='fixed inset-0 z-[80] flex flex-col items-center justify-center gap-3 bg-black/80 px-6 text-center backdrop-blur-2xl'
			style={{pointerEvents: 'auto'}}
		>
			<div className='text-17 font-medium text-white/90'>
				<Loading>{t('restart.restarting')}</Loading>
			</div>
			<p className='max-w-[420px] text-14 leading-snug text-white/65'>{t('storage-mgr.restart.reason')}</p>
			<p className='max-w-[420px] text-13 leading-snug text-white/40'>{t('restart.restarting-message')}</p>
		</div>
	)
}

// ---------------------------------------------------------------------------
// The lab's Simulate menu
// ---------------------------------------------------------------------------

type Condition = keyof typeof driveConditions | 'ok' | 'failed' | 'missing' | 'unusable'

const conditions: {id: Condition; label: string; nvmeOnly?: boolean}[] = [
	{id: 'ok', label: 'Healthy'},
	{id: 'unknown', label: 'Health unknown'},
	{id: 'failing', label: 'Failing its health check'},
	{id: 'faulty', label: 'Too many errors'},
	{id: 'errors', label: 'Reporting errors'},
	{id: 'hot', label: 'Running hot', nvmeOnly: true},
	{id: 'critical', label: 'Far too hot', nvmeOnly: true},
	{id: 'worn', label: 'Nearly worn out', nvmeOnly: true},
	{id: 'failed', label: 'Failed'},
	{id: 'missing', label: 'Unplugged'},
	{id: 'unusable', label: 'Connected, can’t be used'},
]

function conditionOf(member: Member, drive: Drive | undefined): Condition {
	if (member.state === 'failed' || member.state === 'missing' || member.state === 'unusable') return member.state
	if (drive?.smart === 'unknown') return 'unknown'
	return troubleOf(drive) ?? 'ok'
}

export function SimulateMenu({
	sim,
	view,
	dispatch,
	refusing,
	onRefusing,
	brand,
	onBrand,
	onReset,
	onClose,
}: {
	sim: Sim
	view: PoolView
	dispatch: (event: SimEvent) => void
	refusing: boolean
	onRefusing: (refusing: boolean) => void
	brand: Brand
	onBrand: (brand: Brand) => void
	onReset: () => void
	onClose: () => void
}) {
	const isPro = sim.device === 'pro'
	const all = [...sim.pool.members, ...sim.pool.accel]
	const full = view.capacity.usable > 0 ? sim.pool.used / view.capacity.usable : 0

	// A drive is put back to healthy first, so one condition never stacks on another
	const setCondition = (member: Member, next: Condition) => {
		dispatch({type: 'replug', id: member.id})
		dispatch({type: 'condition', id: member.id, condition: 'ok'})
		if (next === 'failed') dispatch({type: 'fail', id: member.id})
		else if (next === 'missing') dispatch({type: 'unplug', id: member.id})
		else if (next === 'unusable') dispatch({type: 'corrupt', id: member.id})
		else if (next !== 'ok') dispatch({type: 'condition', id: member.id, condition: next})
	}

	return (
		<LabPanel title='Simulate' onClose={onClose}>
			<LabGroup label='Plug in a new drive'>
				<div className='flex flex-wrap gap-1.5'>
					{!isPro &&
						sizesTb.hdd.map((size) => (
							<button
								key={`h${size}`}
								type='button'
								className={labChipClass}
								onClick={() => dispatch({type: 'insert', kind: 'hdd', sizeTb: size})}
							>
								{size}TB hard drive
							</button>
						))}
					{sizesTb.ssd.map((size) => (
						<button
							key={`s${size}`}
							type='button'
							className={labChipClass}
							onClick={() => dispatch({type: 'insert', kind: 'ssd', sizeTb: size})}
						>
							{size}TB SSD
						</button>
					))}
				</div>
			</LabGroup>

			<LabGroup label='Drives in your storage'>
				{all.map((member, index) => {
					const drive = view.driveOf(member.id)
					const isAccel = index >= sim.pool.members.length
					const working = member.state === 'rebuilding' || member.state === 'joining'
					const nvme = drive?.temperatureWarning !== undefined
					return (
						<label key={member.id} className='flex items-center gap-2'>
							<span className='min-w-0 flex-1 truncate'>
								{drive ? formatSize(drive.size) : '?'}{' '}
								{isAccel ? 'acceleration SSD' : isPro ? `SSD ${drive?.slot ?? '?'}` : `drive ${index + 1}`}
							</span>
							{working ? (
								<span className='text-12 text-white/45'>{member.state}</span>
							) : (
								<select
									value={conditionOf(member, drive)}
									onChange={(event) => setCondition(member, event.target.value as Condition)}
									className='max-w-[170px] rounded-lg border border-white/15 bg-white/10 px-2 py-1 text-12 text-white/90 outline-hidden focus-visible:ring-2 focus-visible:ring-white/40'
								>
									{conditions
										.filter((condition) => !condition.nvmeOnly || nvme)
										.map((condition) => (
											<option key={condition.id} value={condition.id} className='bg-neutral-900'>
												{condition.label}
											</option>
										))}
								</select>
							)}
						</label>
					)
				})}
			</LabGroup>

			{view.loose.length > 0 && (
				<LabGroup label='New drives'>
					{view.loose.map((drive) => (
						<div key={drive.id} className='flex items-center gap-2'>
							<span className='min-w-0 flex-1 truncate'>
								{formatSize(drive.size)} {drive.kind === 'ssd' ? 'SSD' : 'hard drive'}
							</span>
							<button type='button' className={labChipClass} onClick={() => dispatch({type: 'eject', id: drive.id})}>
								Take out
							</button>
						</div>
					))}
				</LabGroup>
			)}

			<LabGroup label='Your data'>
				<div className='flex flex-wrap gap-1.5'>
					<button
						type='button'
						className={labChipClass}
						aria-pressed={sim.pool.dataErrors > 0}
						onClick={() => dispatch({type: 'damage', errors: sim.pool.dataErrors ? 0 : 3})}
					>
						Damaged data
					</button>
					<button
						type='button'
						className={labChipClass}
						aria-pressed={full >= 0.9}
						onClick={() => dispatch({type: 'fill', fraction: full >= 0.9 ? 0.38 : 0.94})}
					>
						Nearly full
					</button>
					{sim.pool.accel.length > 0 && (
						<button
							type='button'
							className={labChipClass}
							aria-pressed={(sim.pool.accelUsed ?? 0) > 0.7}
							onClick={() =>
								dispatch({
									type: 'set',
									sim: {...sim, pool: {...sim.pool, accelUsed: (sim.pool.accelUsed ?? 0) > 0.7 ? 0.06 : 0.78}},
								})
							}
						>
							Acceleration nearly full
						</button>
					)}
				</div>
			</LabGroup>

			<LabGroup label='umbreld'>
				<div className='flex flex-wrap gap-1.5'>
					<button type='button' className={labChipClass} aria-pressed={refusing} onClick={() => onRefusing(!refusing)}>
						Refuse the next request
					</button>
					{sim.finished && (
						<button type='button' className={labChipClass} onClick={() => dispatch({type: 'forget'})}>
							Forget what just finished
						</button>
					)}
				</div>
			</LabGroup>

			<LabGroup label='Wallpaper colour'>
				<LabChips options={brands} value={brand} onChange={onBrand} />
			</LabGroup>

			<button type='button' className={cn(labChipClass, 'self-start')} onClick={onReset}>
				Reset this scenario
			</button>
		</LabPanel>
	)
}
