// Storage lab: the screens around Storage Manager, on pretend hardware. The one shown in
// place of login when storage can't start, Storage Manager on machines with a single drive,
// and Storage Manager when it can't read the storage at all.

import {useEffect, useMemo, useState} from 'react'
import {useNavigate, useParams} from 'react-router-dom'

import {OnboardingBackground} from '@/components/onboarding-background'
import {Loading} from '@/components/ui/loading'
import {Drive, GB, TB} from '@/features/storage/model'
import {SingleDriveManager, SingleHost, StorageUnreadable} from '@/features/storage/single-drive'
import {StartFailure, StartFailureDrive} from '@/features/storage/start-failure'
import {OnboardingPage} from '@/layouts/bare/onboarding-page'
import {ImmersiveDialogProvider} from '@/providers/immersive-dialog'

import {LabBar, labButtonClass, LabChips, LabGroup, LabPanel} from './chrome'
import {conditions, makeDrive, parseHardware, usbDrives} from './fixtures'

// A small line that says what a button would have done
function useNotice() {
	const [notice, setNotice] = useState<string | null>(null)
	useEffect(() => {
		if (!notice) return
		const timer = setTimeout(() => setNotice(null), 2600)
		return () => clearTimeout(timer)
	}, [notice])
	const element = notice && (
		<div
			role='status'
			className='pointer-events-none fixed inset-x-0 bottom-16 z-[90] flex justify-center px-4 md:bottom-6'
		>
			<span className='rounded-full border border-white/15 bg-black/85 px-4 py-2 text-13 text-white/85 shadow-xl backdrop-blur-md'>
				{notice}
			</span>
		</div>
	)
	return [element, setNotice] as const
}

// ---------------------------------------------------------------------------
// Storage that can't start
// ---------------------------------------------------------------------------

type StartCase = 'two-silent' | 'one-gone' | 'all-present' | 'unknown' | 'check-failed' | 'unconfirmed'

const startCases: {id: StartCase; label: string}[] = [
	{id: 'two-silent', label: 'Two drives not responding'},
	{id: 'one-gone', label: 'One drive not detected'},
	{id: 'all-present', label: 'Every drive responds'},
	{id: 'unknown', label: 'umbreld can’t say which'},
	{id: 'check-failed', label: 'The check itself failed'},
	{id: 'unconfirmed', label: 'umbreld isn’t answering'},
]

export function StartFailureLab() {
	const {device} = useParams()
	return <StartFailureScreen key={device} />
}

function StartFailureScreen() {
	const {device} = useParams()
	const isPro = device === 'pro'
	const [which, setWhich] = useState<StartCase>('two-silent')
	const [menuOpen, setMenuOpen] = useState(false)
	const [away, setAway] = useState<'restarting' | 'checking' | null>(null)
	const [notice, setNotice] = useNotice()
	const drives = useMemo(
		() => parseHardware(isPro ? 'pro:s4,s4,s4,s4' : 'nas:s0.25b,h8,h8,h8,h8,h4').hardware.drives,
		[isPro],
	)

	// A restart takes a moment, and here it doesn't help: the point is the screen after it
	useEffect(() => {
		if (!away) return
		const timer = setTimeout(() => setAway(null), away === 'restarting' ? 2600 : 900)
		return () => clearTimeout(timer)
	}, [away])

	const members = drives.filter((drive) => !drive.system).slice(0, 4)
	const entries: StartFailureDrive[] = drives
		.filter((drive) => !drive.system)
		.map((drive): StartFailureDrive => {
			const index = members.indexOf(drive)
			if (index === -1) return {drive}
			if (which === 'unknown' || which === 'check-failed') return {drive, member: {}}
			if (which === 'two-silent' && (index === 1 || index === 2)) return {drive, member: {responding: false}}
			// A drive that is gone leaves its name in the storage and nothing else. On Umbrel Pro
			// that means its slot isn't known either.
			if (which === 'one-gone' && index === 2) {
				return {drive: {...drive, absent: true, slot: undefined, size: 0}, member: {responding: false}}
			}
			return {drive, member: {responding: true}}
		})

	return (
		<>
			<OnboardingPage>
				{away === 'restarting' ? (
					<div className='flex flex-1 flex-col items-center justify-center text-17 text-white/85'>
						<Loading>Restarting</Loading>
					</div>
				) : (
					<StartFailure
						device={isPro ? 'pro' : 'other'}
						drives={entries}
						loading={away === 'checking'}
						unconfirmed={which === 'unconfirmed'}
						checkError={
							which === 'check-failed'
								? 'TRPCClientError: hardware.raid.checkRaidMountFailureDevices: request timed out'
								: which === 'unconfirmed'
									? 'TRPCClientError: Failed to fetch'
									: undefined
						}
						onCheckAgain={() => setAway('checking')}
						onRestart={() => setAway('restarting')}
						onShutdown={() => setNotice('Your Umbrel would shut down here.')}
						onFactoryReset={() => setNotice('Your Umbrel would be factory reset here.')}
						footerStart={<span className='text-13 text-white/40'>English</span>}
					/>
				)}
			</OnboardingPage>
			{notice}
			<LabBar title={isPro ? 'Umbrel Pro · storage couldn’t start' : 'Hard drives · storage couldn’t start'}>
				<button type='button' className={labButtonClass} onClick={() => setMenuOpen((value) => !value)}>
					Simulate
				</button>
			</LabBar>
			{menuOpen && (
				<LabPanel title='Simulate' onClose={() => setMenuOpen(false)}>
					<LabGroup label='What umbreld reports'>
						<LabChips options={startCases} value={which} onChange={setWhich} />
					</LabGroup>
				</LabPanel>
			)}
		</>
	)
}

// ---------------------------------------------------------------------------
// Storage Manager with one drive, and Storage Manager that can't read the storage
// ---------------------------------------------------------------------------

type SingleKind = 'home' | 'pi' | 'pc' | 'container' | 'unreadable' | 'unidentified'
type SingleCondition = 'ok' | 'failing' | 'hot' | 'critical' | 'worn' | 'full' | 'usage-failed'

const singleConditions: {id: SingleCondition; label: string}[] = [
	{id: 'ok', label: 'Healthy'},
	{id: 'failing', label: 'Failing its health check'},
	{id: 'hot', label: 'Running hot'},
	{id: 'critical', label: 'Far too hot'},
	{id: 'worn', label: 'Nearly worn out'},
	{id: 'full', label: 'Nearly full'},
	{id: 'usage-failed', label: 'Usage can’t be read'},
]

const singleKinds: SingleKind[] = ['home', 'pi', 'pc', 'container', 'unreadable', 'unidentified']
const hosts: Record<Exclude<SingleKind, 'unreadable' | 'unidentified'>, {host: SingleHost; label: string}> = {
	home: {host: 'home', label: 'Umbrel Home'},
	pi: {host: 'pi', label: 'Raspberry Pi'},
	pc: {host: 'other', label: 'Other hardware'},
	container: {host: 'container', label: 'A container'},
}

export function SingleDriveLab() {
	const {kind} = useParams()
	// Each machine starts from its own state
	return <SingleDrive key={kind} />
}

function SingleDrive() {
	const {kind: kindParam} = useParams()
	const navigate = useNavigate()
	const kind = singleKinds.find((value) => value === kindParam) ?? 'home'
	const [condition, setCondition] = useState<SingleCondition>('ok')
	const [menuOpen, setMenuOpen] = useState(false)
	const [retrying, setRetrying] = useState(false)
	const [notice, setNotice] = useNotice()
	const close = () => navigate('/storage-lab')

	// What each machine has: the drive it starts from when umbreld can see it, and any others
	const machine = useMemo(() => {
		if (kind === 'home') return {drive: makeDrive('ssd', 2, {system: true}), others: [], total: 2 * TB, used: 640 * GB}
		if (kind === 'pc') {
			return {
				drive: makeDrive('ssd', 0.5, {system: true}),
				others: [makeDrive('hdd', 8), makeDrive('hdd', 8), makeDrive('ssd', 1)],
				total: 0.5 * TB,
				used: 162 * GB,
			}
		}
		if (kind === 'pi') return {drive: undefined, others: [], total: 256 * GB, used: 71 * GB}
		return {drive: undefined, others: [], total: 1 * TB, used: 318 * GB}
	}, [kind])

	useEffect(() => {
		if (!retrying) return
		const timer = setTimeout(() => setRetrying(false), 1400)
		return () => clearTimeout(timer)
	}, [retrying])

	if (kind === 'unreadable' || kind === 'unidentified') {
		const listed: {drive: Drive; role?: string; state?: string}[] =
			kind === 'unidentified'
				? [
						{drive: makeDrive('hdd', 8), role: 'Storage drive', state: 'Unavailable'},
						{drive: {...makeDrive('hdd', 8), absent: true, size: 0}, role: 'Storage drive'},
						{drive: makeDrive('hdd', 8), role: 'Storage drive', state: 'Online'},
						{drive: makeDrive('ssd', 0.25, {system: true}), state: 'System drive'},
					]
				: []
		return (
			<ImmersiveDialogProvider>
				<OnboardingBackground />
				<StorageUnreadable
					reason={kind === 'unreadable' ? 'no-answer' : 'unidentified'}
					detail={kind === 'unreadable' ? 'hardware.raid.getStatus: request timed out after 30000ms' : undefined}
					drives={listed}
					// As in Settings: what is on screen stays while it looks again
					retrying={retrying}
					onRetry={() => setRetrying(true)}
					onClose={close}
				/>
				<LabBar
					title={kind === 'unreadable' ? 'Storage Manager can’t read the storage' : 'The storage can’t be identified'}
				/>
			</ImmersiveDialogProvider>
		)
	}

	const {host, label} = hosts[kind]
	const troubled =
		machine.drive && condition !== 'ok' && condition !== 'full' && condition !== 'usage-failed'
			? {...machine.drive, ...conditions[condition]}
			: machine.drive
	const usage = condition === 'usage-failed' || retrying ? undefined : condition === 'full' ? 0.95 : undefined

	return (
		<ImmersiveDialogProvider>
			<OnboardingBackground />
			<SingleDriveManager
				host={host}
				drive={troubled}
				others={machine.others}
				usage={
					condition === 'usage-failed' || retrying
						? undefined
						: {total: machine.total, used: usage ? machine.total * usage : machine.used}
				}
				usageFailed={condition === 'usage-failed' && !retrying}
				onRetryUsage={() => setRetrying(true)}
				usb={kind === 'pi' ? {drives: usbDrives, onOpenFiles: () => setNotice('Files would open here.')} : undefined}
				onOpenBackups={() => setNotice('Backups would open here.')}
				onViewUsage={() => setNotice('Live Usage would open here.')}
				onClose={close}
				supportUrl='https://umbrel.com/support'
				downloadUrl='https://umbrel.com/downloads'
			/>
			{notice}
			<LabBar title={`${label} · Storage Manager`}>
				<button type='button' className={labButtonClass} onClick={() => setMenuOpen((value) => !value)}>
					Simulate
				</button>
			</LabBar>
			{menuOpen && (
				<LabPanel title='Simulate' onClose={() => setMenuOpen(false)}>
					<LabGroup label='The drive everything is on'>
						<LabChips
							options={singleConditions.filter(
								(option) =>
									// Trouble is only known for a drive umbreld can see
									machine.drive || option.id === 'ok' || option.id === 'full' || option.id === 'usage-failed',
							)}
							value={condition}
							onChange={setCondition}
						/>
					</LabGroup>
				</LabPanel>
			)}
		</ImmersiveDialogProvider>
	)
}
