// Storage lab: the onboarding storage step, start to finish, on pretend hardware. The screens
// are the real ones from features/storage. The lab stands in for umbreld: it finds the drives,
// creates the storage, and can be told to be slow, to lose the connection, or to fail.

import {useEffect, useMemo, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {useNavigate, useParams, useSearchParams} from 'react-router-dom'

import {Hardware, Setup} from '@/features/storage/model'
import {
	DoneStage,
	EarlierSetupStage,
	FailedStage,
	NoDrivesStage,
	ScanStage,
	WorkingStage,
} from '@/features/storage/setup/stages'
import {ShutDownDialog, StorageStep} from '@/features/storage/setup/storage-step'
import {OnboardingPage} from '@/layouts/bare/onboarding-page'
import {secondaryButtonClasss} from '@/layouts/bare/shared'

import {LabBar, labButtonClass, LabChips, LabGroup, LabPanel} from './chrome'
import {onboardingScenarios, parseHardware, stateFromSetup} from './fixtures'

type Stage = 'scan' | 'none' | 'earlier' | 'setup' | 'working' | 'failed' | 'done'
// What the pretend umbreld does when asked to set up storage or restore an earlier setup
type Outcome = 'ok' | 'slow' | 'lost' | 'fails' | 'fails-for-good'

const outcomes: {id: Outcome; label: string}[] = [
	{id: 'ok', label: 'Succeeds'},
	{id: 'slow', label: 'Takes a long time'},
	{id: 'lost', label: 'Connection lost'},
	{id: 'fails', label: 'Fails once'},
	{id: 'fails-for-good', label: 'Fails for good'},
]

export default function OnboardingLab() {
	const {scenarioId} = useParams()
	const [params] = useSearchParams()
	const scenario = onboardingScenarios.find((candidate) => candidate.id === scenarioId)
	const spec = scenario?.hardware ?? params.get('hw') ?? 'nas:h8,h8'
	const {hardware, earlierSetup} = useMemo(() => parseHardware(spec), [spec])
	const [run, setRun] = useState(0)
	const [outcome, setOutcome] = useState<Outcome>('ok')
	const [menuOpen, setMenuOpen] = useState(false)

	return (
		<>
			<OnboardingPage>
				<Flow key={`${spec}-${run}`} hardware={hardware} hasEarlierSetup={earlierSetup} outcome={outcome} />
			</OnboardingPage>
			<LabBar title={scenario ? `${scenario.group} · ${scenario.title}` : 'Your own hardware'}>
				<button type='button' className={labButtonClass} onClick={() => setRun((value) => value + 1)}>
					Restart
				</button>
				<button type='button' className={labButtonClass} onClick={() => setMenuOpen((value) => !value)}>
					Simulate
				</button>
			</LabBar>
			{menuOpen && (
				<LabPanel title='Simulate' onClose={() => setMenuOpen(false)}>
					<LabGroup label='When storage is set up, or an earlier setup is restored'>
						<LabChips options={outcomes} value={outcome} onChange={setOutcome} />
					</LabGroup>
					<p className='text-12 leading-snug text-white/45'>
						Pick one, then continue through the setup. “Fails once” succeeds when tried again.
					</p>
				</LabPanel>
			)}
		</>
	)
}

function Flow({hardware, hasEarlierSetup, outcome}: {hardware: Hardware; hasEarlierSetup: boolean; outcome: Outcome}) {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const [stage, setStage] = useState<Stage>('scan')
	const [restoring, setRestoring] = useState(false)
	const [shuttingDown, setShuttingDown] = useState(false)
	// Everything the pretend umbreld has to say about the work it is doing
	const [progress, setProgress] = useState(0)
	const [waiting, setWaiting] = useState<'still-working' | 'connection-lost' | undefined>()
	// Checking again found the work still going, so it is left to finish
	const [resumed, setResumed] = useState(false)
	// How many times the setup has been started: "fails once" works the second time
	const [attempt, setAttempt] = useState(0)
	const [setup, setSetup] = useState<Setup | null>(null)
	const isPro = hardware.device === 'pro'
	const usable = hardware.drives.filter((drive) => !drive.system)
	// A machine with nothing but SSDs is told about SSDs
	const ssd = usable.every((drive) => drive.kind === 'ssd')

	// The scan is a beat, not a wait
	useEffect(() => {
		if (stage !== 'scan') return
		const timer = setTimeout(
			() => setStage(usable.length === 0 ? 'none' : hasEarlierSetup ? 'earlier' : 'setup'),
			isPro ? 2200 : 1300,
		)
		return () => clearTimeout(timer)
	}, [stage, usable.length, hasEarlierSetup, isPro])

	// Creating the storage: steady progress, unless the lab was told otherwise
	const result = outcome === 'fails' && attempt > 0 ? 'ok' : outcome
	useEffect(() => {
		if (stage !== 'working' || waiting) return
		const timer = setInterval(() => setProgress((value) => Math.min(100, value + 1.6)), 70)
		return () => clearInterval(timer)
	}, [stage, waiting])
	useEffect(() => {
		if (stage !== 'working' || waiting) return
		if ((result === 'fails' || result === 'fails-for-good') && progress >= 58) setStage('failed')
		else if (result === 'slow' && progress >= 62 && !resumed) setWaiting('still-working')
		else if (result === 'lost' && progress >= 50 && !resumed) setWaiting('connection-lost')
		else if (progress >= 100) setStage('done')
	}, [progress, stage, waiting, result, resumed])

	const start = (isRestore: boolean) => {
		setRestoring(isRestore)
		setProgress(0)
		setWaiting(undefined)
		setResumed(false)
		setStage('working')
	}

	if (stage === 'scan') return <ScanStage isPro={isPro} />

	if (stage === 'none') {
		return (
			<>
				<NoDrivesStage isPro={isPro} onLookAgain={() => setStage('scan')} onShutdown={() => setShuttingDown(true)} />
				<ShutDownDialog
					isPro={isPro}
					ssd={ssd}
					open={shuttingDown}
					onOpenChange={setShuttingDown}
					onShutdown={() => undefined}
					reason='change'
				/>
			</>
		)
	}

	if (stage === 'earlier') {
		return (
			<EarlierSetupStage
				isPro={isPro}
				drives={usable.map((drive) => ({id: drive.id, drive, tone: 'in' as const}))}
				onRestore={() => start(true)}
				onSetUpAsNew={() => setStage('setup')}
			/>
		)
	}

	if (stage === 'working') {
		return (
			<WorkingStage
				isPro={isPro}
				ssd={ssd}
				restoring={restoring}
				progress={progress}
				waiting={waiting}
				// Looking again finds that it finished after all
				onCheckAgain={() => {
					setResumed(true)
					setWaiting(undefined)
					setProgress(88)
				}}
				actions={
					waiting && (
						<button className={secondaryButtonClasss} onClick={() => setStage('scan')}>
							{t('onboarding.raid.return-to-start')}
						</button>
					)
				}
			/>
		)
	}

	if (stage === 'failed') {
		return (
			<>
				<FailedStage
					ssd={ssd}
					restoring={restoring}
					canRetry={outcome !== 'fails-for-good'}
					detail={
						restoring
							? 'cannot import ‘umbrelos’: one or more devices is currently unavailable'
							: 'zpool create failed: /dev/disk/by-umbrel-id/… is in use and contains an unknown filesystem'
					}
					onRetry={() => {
						setAttempt((value) => value + 1)
						start(restoring)
					}}
					onShutdown={() => setShuttingDown(true)}
					onSetUpAsNew={restoring ? () => setStage('setup') : undefined}
				/>
				<ShutDownDialog
					isPro={isPro}
					ssd={ssd}
					open={shuttingDown}
					onOpenChange={setShuttingDown}
					onShutdown={() => undefined}
					reason='check'
				/>
			</>
		)
	}

	if (stage === 'done') {
		const launch = t('onboarding.launch-umbrelos')
		// The terms line as onboarding shows it, with its link drawn and not followed
		const [before, linked, after] = t('onboarding.account-created.by-clicking-button-you-agree', {
			button: launch,
		}).split(/<\/?linked>/)
		return (
			<DoneStage
				isPro={isPro}
				name={restoring ? undefined : 'Alex'}
				restored={restoring}
				storage={
					setup
						? {
								usable: setup.capacity.usable,
								kind: setup.kind,
								level: setup.layout === 'stripe' ? null : setup.layout,
								accel: setup.accel.chosen.length,
							}
						: undefined
				}
				onLaunch={() => navigate('/storage-lab')}
				terms={
					<p className='max-w-[420px] text-center text-12 leading-snug text-white/45'>
						{before}
						<span className='underline underline-offset-2'>{linked}</span>
						{after}
					</p>
				}
				extra={
					setup && (
						<button
							className={secondaryButtonClasss}
							onClick={() =>
								navigate('/storage-lab/manager/from-setup', {
									state: {sim: stateFromSetup(hardware.device, setup, hardware.drives)},
								})
							}
						>
							Open Storage Manager
						</button>
					)
				}
			/>
		)
	}

	return (
		<StorageStep
			hardware={hardware}
			earlierSetup={hasEarlierSetup}
			recommendedSsdSize='512GB'
			onBack={hasEarlierSetup ? () => setStage('earlier') : undefined}
			onContinue={(_config, chosen) => {
				setSetup(chosen)
				start(false)
			}}
			onShutdown={() => undefined}
		/>
	)
}
