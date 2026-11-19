// Storage lab: how someone finds out. Storage trouble starts outside Storage Manager: a toast
// when umbrelOS opens, a badge and a card in Settings, the island while something is under
// way, a notification after a storage check. Every one of them says what Storage Manager
// says, because every one of them is worded by the same getStatus().

import {useMemo, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {IoShieldHalf} from 'react-icons/io5'
import {TbAlertTriangleFilled, TbArrowRight} from 'react-icons/tb'
import {Link} from 'react-router-dom'

import {OnboardingBackground} from '@/components/onboarding-background'
import {toast} from '@/components/ui/toast'
import {StatusBadge} from '@/features/storage/art'
import {ExpandedContent} from '@/features/storage/components/floating-island/expanded'
import type {IslandRaidProgress} from '@/features/storage/components/floating-island/index'
import {MinimizedContent} from '@/features/storage/components/floating-island/minimized'
import {getStatus} from '@/features/storage/manager/status'
import {formatSize} from '@/features/storage/model'
import {Operation, StorageState, viewPool} from '@/features/storage/state'
import {cn} from '@/lib/utils'

import {LabBar, LabChips} from './chrome'
import {managerScenarios} from './fixtures'

const situations = [
	{id: 'nas-z1-failed', label: 'A drive has failed'},
	{id: 'nas-warning', label: 'A drive may fail soon'},
	{id: 'nas-rebuilding', label: 'Rebuilding'},
	{id: 'nas-transition', label: 'FailSafe · copying'},
	{id: 'nas-restarting', label: 'FailSafe · restarting'},
	{id: 'nas-finishing', label: 'FailSafe · protecting'},
	{id: 'nas-mirroring', label: 'FailSafe · mirrored pairs'},
	{id: 'nas-expanding', label: 'Adding a drive'},
	{id: 'nas-damaged', label: 'Damaged data'},
	{id: 'nas-nearly-full', label: 'Nearly full'},
	{id: 'nas-switched', label: 'FailSafe just finished'},
	{id: 'nas-rebuilt', label: 'A rebuild just finished'},
	{id: 'nas-z1', label: 'Nothing to report'},
] as const

// The island's own shape for a task, as umbreld's events give it
function islandOperation(state: StorageState): IslandRaidProgress | null {
	const op: Operation | null = state.op
	if (!op || op.kind === 'check') return null
	if (op.kind === 'rebuild') return {type: 'replace', state: 'rebuilding', progress: op.progress}
	if (op.kind === 'expand') return {type: 'expansion', state: 'expanding', progress: op.progress}
	return {
		type: 'failsafe-transition',
		state: op.phase === 'copying' ? 'syncing' : op.phase === 'restarting' ? 'rebooting' : 'rebuilding',
		progress: op.progress,
	}
}

export default function NoticesLab() {
	const {t, i18n} = useTranslation()
	const [situation, setSituation] = useState<(typeof situations)[number]['id']>('nas-z1-failed')
	const state = useMemo(() => managerScenarios.find((scenario) => scenario.id === situation)!.build(), [situation])
	const view = viewPool(state)
	const status = getStatus(state, view, t, i18n.language)
	const operation = islandOperation(state)
	const mirrored = state.pool.layout === 'mirror'
	const quiet = status.tone === 'protected' || status.tone === 'unprotected' || status.tone === 'healthy'
	const finished = !!state.finished && state.finished.kind !== 'expand'
	// A problem raises the badge and the toast. Work in progress has the island instead.
	const alarming = status.tone === 'attention' || status.tone === 'critical'
	const damaged = state.pool.dataErrors > 0

	return (
		<>
			<OnboardingBackground />
			<div className='relative flex min-h-svh justify-center p-4 pt-16 md:p-8'>
				<div
					className='umbrel-material flex w-full max-w-[920px] flex-col gap-7 self-start rounded-3xl p-5 md:p-8'
					style={{'--material-blur': '40px'} as React.CSSProperties}
				>
					<header className='flex flex-col gap-2'>
						<h1 className='text-24 font-bold text-white/90'>How you find out</h1>
						<p className='max-w-[640px] text-14 leading-relaxed text-white/55'>
							Storage Manager is rarely where trouble is first seen. These are the places umbrelOS raises it, each with
							the sentence Storage Manager itself leads with, so the story is the same wherever it is read.
						</p>
						<LabChips options={situations} value={situation} onChange={setSituation} />
					</header>

					<Surface
						title='When umbrelOS opens'
						note='A toast, top right. The whole toast opens Storage Manager.'
						shown={alarming || finished}
						empty='Nothing is raised.'
					>
						<div className='flex flex-wrap items-center gap-3'>
							<Toast title={status.title} body={status.body} good={finished} />
							<button
								type='button'
								onClick={() =>
									(finished ? toast.success : toast.warning)(status.title, {description: status.body, area: 'settings'})
								}
								className='rounded-full bg-white/10 px-3 py-1.5 text-12 font-medium text-white/80 outline-hidden transition-colors hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white/40'
							>
								Show the real toast
							</button>
						</div>
					</Surface>

					<Surface title='In Settings' note='A count on the Settings icon, and the storage card says why.' shown>
						<div className='flex flex-wrap items-start gap-4'>
							<div className='relative flex size-14 items-center justify-center rounded-[14px] bg-white/10'>
								<img src='/assets/dock/dock-settings.webp' alt='' className='size-12' draggable={false} />
								{alarming && (
									<span className='absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-[#FF3434] text-11 font-bold text-white'>
										1
									</span>
								)}
							</div>
							<div className='flex min-w-[260px] flex-1 flex-col gap-3 rounded-17 bg-white/5 p-4'>
								<div className='flex items-center justify-between gap-3'>
									<span className='text-13 font-semibold text-white/50'>Storage</span>
									<span className='text-13 text-white/50'>
										{formatSize(state.pool.used)} of {formatSize(view.capacity.usable)} used
									</span>
								</div>
								<div className='flex items-center gap-3'>
									<StatusBadge tone={status.tone} progress={status.progress} className='size-9' />
									<div className='flex min-w-0 flex-1 flex-col'>
										<span className='text-14 font-medium text-white/90'>{status.title}</span>
										{!quiet && <span className='line-clamp-2 text-12 leading-snug text-white/50'>{status.body}</span>}
									</div>
									<span className='flex shrink-0 items-center gap-1 rounded-full bg-white/10 px-3 py-1.5 text-12 font-medium text-white/85'>
										Manage <TbArrowRight className='size-3.5' />
									</span>
								</div>
							</div>
						</div>
					</Surface>

					<Surface
						title='While something is under way'
						note='The island, on every screen. It shows the same step and the same number as Storage Manager.'
						shown={!!operation}
						empty='No island: nothing is running.'
					>
						{operation && (
							<div className='flex flex-wrap items-center gap-4'>
								<div className='h-9 w-[190px] overflow-hidden rounded-full bg-black shadow-xl ring-1 ring-white/10'>
									<MinimizedContent operation={operation} deviceType={state.pool.kind} mirrored={mirrored} />
								</div>
								<div className='h-[150px] w-[340px] max-w-full overflow-hidden rounded-[32px] bg-black shadow-xl ring-1 ring-white/10'>
									<ExpandedContent operation={operation} deviceType={state.pool.kind} mirrored={mirrored} />
								</div>
							</div>
						)}
					</Surface>

					<Surface
						title='After a storage check'
						note='The one notification storage sends: a check that found damage it couldn’t repair.'
						shown={damaged}
						empty='No notification.'
					>
						<div className='flex max-w-[420px] flex-col gap-3 rounded-24 bg-black/60 p-5 ring-1 ring-white/10'>
							<span className='flex size-12 items-center justify-center rounded-2xl bg-[#FF3434]/15 text-[#FF6B6B]'>
								<TbAlertTriangleFilled className='size-6' />
							</span>
							<span className='text-17 font-semibold text-white'>{status.title}</span>
							<span className='text-13 leading-snug text-white/55'>{status.body}</span>
							<div className='mt-1 flex gap-2'>
								<span className='rounded-full bg-white px-4 py-2 text-13 font-medium text-black'>
									{t('notifications.raid.issue.action')}
								</span>
								<span className='rounded-full bg-white/10 px-4 py-2 text-13 font-medium text-white/85'>
									{t('notifications.dismiss')}
								</span>
							</div>
						</div>
					</Surface>

					<p className='border-t border-white/10 pt-5 text-12 leading-relaxed text-white/40'>
						The end of a long task is only known to a browser that was open when it ended: umbreld keeps no record of
						when a rebuild or a switch to FailSafe finished. That is on the list of things{' '}
						<Link to='/storage-lab/map' className='underline underline-offset-2 hover:text-white/70'>
							umbreld would need to add
						</Link>
						.
					</p>
				</div>
			</div>
			<LabBar title='How you find out' />
		</>
	)
}

function Surface({
	title,
	note,
	shown,
	empty,
	children,
}: {
	title: string
	note: string
	shown: boolean
	empty?: string
	children: React.ReactNode
}) {
	return (
		<section className='flex flex-col gap-3'>
			<div className='flex flex-col gap-0.5'>
				<h2 className='text-14 font-semibold text-white/90'>{title}</h2>
				<p className='text-12 leading-snug text-white/45'>{note}</p>
			</div>
			{shown ? children : <p className='text-13 text-white/35'>{empty}</p>}
		</section>
	)
}

// A still of the toast, so the page can be read without firing one
function Toast({title, body, good}: {title: string; body: string; good: boolean}) {
	return (
		<div className='flex w-[356px] max-w-full items-center gap-2.5 rounded-[18px] bg-black/70 px-3 py-3 ring-1 ring-white/10 backdrop-blur-xl'>
			<span
				className={cn(
					'flex size-8 shrink-0 items-center justify-center rounded-full',
					good ? 'bg-white text-black' : 'bg-[#F5A623]/20 text-[#F5A623]',
				)}
			>
				{good ? <IoShieldHalf className='size-4' /> : <TbAlertTriangleFilled className='size-4' />}
			</span>
			<span className='flex min-w-0 flex-1 flex-col'>
				<span className='text-14 leading-snug font-medium text-white'>{title}</span>
				<span className='text-13 leading-snug text-white/45'>{body}</span>
			</span>
		</div>
	)
}
