// Storage lab: the index. Every onboarding, Storage Manager and surrounding scenario, a way
// to describe any other machine, and the map the mocks were built against. Throwaway: these
// routes only exist in the dev server.

import {useState} from 'react'
import {TbArrowRight, TbFlask, TbMap2, TbMinus, TbPlus} from 'react-icons/tb'
import {Link, useNavigate} from 'react-router-dom'

import {OnboardingBackground} from '@/components/onboarding-background'
import {DriveKind} from '@/features/storage/model'
import {cn} from '@/lib/utils'

import {managerScenarios, onboardingScenarios, otherScenarios, sizesTb} from './fixtures'

// The two kinds of machine with storage to set up, as the hardware format names them
type Machine = 'nas' | 'pro'

type Tab = 'onboarding' | 'manager' | 'other'

type Entry = {id: string; group: string; title: string; note: string; to: string}

const entries: Record<Tab, Entry[]> = {
	onboarding: onboardingScenarios.map((item) => ({...item, to: `/storage-lab/onboarding/${item.id}`})),
	manager: managerScenarios.map((item) => ({...item, to: `/storage-lab/manager/${item.id}`})),
	other: otherScenarios.map((item) => ({...item, to: item.path})),
}

const tabs: [Tab, string][] = [
	['onboarding', 'Onboarding'],
	['manager', 'Storage Manager'],
	['other', 'Other screens'],
]

function groupBy(items: Entry[]): [string, Entry[]][] {
	const groups = new Map<string, Entry[]>()
	for (const item of items) groups.set(item.group, [...(groups.get(item.group) ?? []), item])
	return [...groups.entries()]
}

export default function StorageLabIndex() {
	const [tab, setTab] = useState<Tab>('onboarding')

	return (
		<>
			<OnboardingBackground />
			<div className='relative flex min-h-svh justify-center p-4 md:p-8'>
				<div
					className='umbrel-material flex w-full max-w-[920px] flex-col gap-6 self-start rounded-3xl p-5 md:p-8'
					style={{'--material-blur': '40px'} as React.CSSProperties}
				>
					<header className='flex flex-col gap-2'>
						<span className='flex w-fit items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-12 font-medium text-white/70'>
							<TbFlask className='size-3.5' />
							Throwaway mocks · no real drives are touched
						</span>
						<h1 className='text-24 font-bold text-white/90 md:text-32'>FailSafe and Storage Manager lab</h1>
						<p className='max-w-[640px] text-14 leading-relaxed text-white/55'>
							Each link opens a pretend machine. The screens are the real ones, the same code onboarding and Settings
							now use, fed by a pretend umbreld instead of the real one. Onboarding scenarios walk the setup for that
							hardware. Storage Manager scenarios open on a state, and the Simulate menu lets you fail a drive, plug a
							new one in, have umbreld refuse a request or skip ahead, so a journey can be followed to its end.
						</p>
					</header>

					<Link
						to='/storage-lab/map'
						className='group flex items-center gap-3.5 rounded-17 border border-white/10 bg-white/[0.06] px-4 py-3.5 outline-hidden transition-colors hover:bg-white/[0.1] focus-visible:ring-2 focus-visible:ring-white/40'
					>
						<TbMap2 className='size-5 shrink-0 text-white/70' />
						<span className='flex min-w-0 flex-1 flex-col gap-0.5'>
							<span className='text-14 font-medium text-white/90'>From umbreld to the screen</span>
							<span className='text-12 leading-snug text-white/45'>
								Every machine, layout rule, call, status field, event and refusal in umbreld, beside the mock that
								handles it.
							</span>
						</span>
						<TbArrowRight className='size-4 shrink-0 text-white/25 transition-colors group-hover:text-white/70' />
					</Link>

					<div className='flex w-fit max-w-full gap-1 overflow-x-auto rounded-full bg-white/[0.07] p-1'>
						{tabs.map(([id, label]) => (
							<button
								key={id}
								type='button'
								onClick={() => setTab(id)}
								aria-pressed={tab === id}
								className={cn(
									'shrink-0 rounded-full px-4 py-1.5 text-13 font-medium outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-white/40',
									tab === id ? 'bg-white/90 text-black' : 'text-white/70 hover:text-white',
								)}
							>
								{label} · {entries[id].length}
							</button>
						))}
					</div>

					<div className='flex flex-col gap-6'>
						{groupBy(entries[tab]).map(([group, items]) => (
							<section key={group} className='flex flex-col gap-2'>
								<h2 className='text-13 font-semibold text-white/50'>{group}</h2>
								<div className='grid gap-2 md:grid-cols-2'>
									{items.map((item) => (
										<Link
											key={item.id}
											to={item.to}
											className='group flex items-center gap-3 rounded-17 bg-white/[0.05] px-4 py-3 outline-hidden transition-colors hover:bg-white/[0.1] focus-visible:ring-2 focus-visible:ring-white/40'
										>
											<span className='flex min-w-0 flex-1 flex-col gap-0.5'>
												<span className='text-14 font-medium text-white/90'>{item.title}</span>
												<span className='text-12 leading-snug text-white/45'>{item.note}</span>
											</span>
											<TbArrowRight className='size-4 shrink-0 text-white/25 transition-colors group-hover:text-white/70' />
										</Link>
									))}
								</div>
							</section>
						))}
					</div>

					{tab === 'onboarding' && <BuildYourOwn />}
					<ReviewNotes />
				</div>
			</div>
		</>
	)
}

// What was decided, and what is still open, kept where the review happens
const reviewNotes: {title: string; body: string}[] = [
	{
		title: 'Decided: two hard drives default to a mirrored pair',
		body: 'As umbreld’s own default is. One-drive protection is one tap away under Protection, with what it does differently.',
	},
	{
		title: 'Decided: mixed sizes default to Full Storage',
		body: 'When FailSafe would leave space unusable, Full Storage is selected, as today, and neither is marked as recommended. FailSafe shows exactly what it would leave unusable.',
	},
	{
		title: 'Decided: with hard drives and SSDs, you choose',
		body: 'Hard drives hold the files by default and the SSDs speed them up. “Keep your files on” switches to the SSDs.',
	},
	{
		title: 'Decided: Umbrel leaves two kinds of drive out by itself',
		body: 'A drive that would shrink every other drive, and a drive failing its health check. Both stay one tap away under Drives, and a failing drive keeps its warning mark.',
	},
	{
		title: 'Decided: only what umbreld reports',
		body: 'No damaged file names, no storage check times, no storage mode before login. What each screen says instead, and what would close each gap, is on the map under Needs umbreld.',
	},
	{
		title: 'Open: FailSafe that is only partly on',
		body: 'umbreld can’t finish or retry it. The screen says to back up, reset and restore, and names Umbrel support as the other way. A retry in umbreld would be the real fix.',
	},
	{
		title: 'Open: durations',
		body: '“A day or more” and “under an hour” are estimates. umbreld reports progress, not time left.',
	},
	{
		title: 'Open: the moment a long task ends',
		body: 'Shown to a browser that was open when it ended, and to no one later, because umbreld keeps no record of when it finished.',
	},
]

function ReviewNotes() {
	return (
		<section className='flex flex-col gap-3 border-t border-white/10 pt-6'>
			<h2 className='text-13 font-semibold text-white/50'>Decisions, and what is still open</h2>
			<div className='grid gap-x-8 gap-y-4 md:grid-cols-2'>
				{reviewNotes.map((note) => (
					<div key={note.title} className='flex flex-col gap-1'>
						<h3 className='text-14 font-medium text-white/90'>{note.title}</h3>
						<p className='text-13 leading-relaxed text-white/50'>{note.body}</p>
					</div>
				))}
			</div>
		</section>
	)
}

// Any machine at all: pick the device and its drives, then walk its onboarding
function BuildYourOwn() {
	const navigate = useNavigate()
	const [device, setDevice] = useState<Machine>('nas')
	const [earlier, setEarlier] = useState(false)
	const [drives, setDrives] = useState<{kind: DriveKind; size: number}[]>([
		{kind: 'hdd', size: 8},
		{kind: 'hdd', size: 8},
		{kind: 'hdd', size: 4},
		{kind: 'ssd', size: 1},
	])
	const usable = device === 'pro' ? drives.filter((drive) => drive.kind === 'ssd').slice(0, 4) : drives
	const spec = `${device}:${usable.map((drive) => `${drive.kind === 'hdd' ? 'h' : 's'}${drive.size}`).join(',')}${
		earlier ? '@earlier' : ''
	}`
	const add = (kind: DriveKind) =>
		setDrives((current) => [...current, {kind, size: kind === 'hdd' ? 8 : 2}].slice(0, device === 'pro' ? 4 : 12))
	const resize = (index: number, step: 1 | -1) =>
		setDrives((current) =>
			current.map((drive, i) => {
				if (i !== index) return drive
				const sizes = [1, 2, 4, 8, 12, 16, 20]
				const next = sizes[Math.min(sizes.length - 1, Math.max(0, sizes.indexOf(drive.size) + step))]
				return {...drive, size: next}
			}),
		)

	return (
		<section className='flex flex-col gap-3 border-t border-white/10 pt-6'>
			<h2 className='text-13 font-semibold text-white/50'>Your own hardware</h2>
			<div className='flex flex-wrap items-center gap-2'>
				{(['nas', 'pro'] as Machine[]).map((id) => (
					<button
						key={id}
						type='button'
						onClick={() => {
							setDevice(id)
							if (id === 'pro') setDrives((current) => current.filter((drive) => drive.kind === 'ssd').slice(0, 4))
						}}
						aria-pressed={device === id}
						className={cn(
							'rounded-full px-3.5 py-1.5 text-13 font-medium outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-white/40',
							device === id ? 'bg-white/90 text-black' : 'bg-white/[0.07] text-white/70 hover:text-white',
						)}
					>
						{id === 'nas' ? 'Other hardware' : 'Umbrel Pro'}
					</button>
				))}
				<span className='mx-1 h-5 w-px bg-white/10' />
				{device === 'nas' && (
					<button type='button' onClick={() => add('hdd')} className={addClass}>
						<TbPlus className='size-3.5' /> Hard drive
					</button>
				)}
				<button type='button' onClick={() => add('ssd')} className={addClass}>
					<TbPlus className='size-3.5' /> SSD
				</button>
			</div>
			<div className='flex flex-wrap gap-2'>
				{usable.length === 0 && <span className='py-2 text-13 text-white/40'>No drives.</span>}
				{usable.map((drive, index) => (
					<div
						key={index}
						className='flex items-center gap-1 rounded-full bg-white/[0.07] py-1 pr-1 pl-3 text-13 text-white/85'
					>
						<span className='w-[92px]'>
							<span className='font-semibold'>{drive.size}TB</span> {drive.kind === 'hdd' ? 'hard drive' : 'SSD'}
						</span>
						<button type='button' aria-label='Smaller' onClick={() => resize(index, -1)} className={stepClass}>
							<TbMinus className='size-3' />
						</button>
						<button type='button' aria-label='Larger' onClick={() => resize(index, 1)} className={stepClass}>
							<TbPlus className='size-3' />
						</button>
						<button
							type='button'
							aria-label='Remove'
							onClick={() => setDrives((current) => current.filter((_, i) => i !== current.indexOf(drive)))}
							className={cn(stepClass, 'text-white/50')}
						>
							×
						</button>
					</div>
				))}
			</div>
			<div className='flex flex-wrap items-center gap-3'>
				<button
					type='button'
					onClick={() => navigate(`/storage-lab/onboarding/custom?hw=${encodeURIComponent(spec)}`)}
					className='flex items-center gap-1.5 rounded-full bg-white/90 px-4 py-2 text-13 font-medium text-black outline-hidden transition-colors hover:bg-white focus-visible:ring-2 focus-visible:ring-white/40'
				>
					Walk this onboarding
					<TbArrowRight className='size-4' />
				</button>
				<code className='text-12 text-white/35'>{spec}</code>
			</div>
			<label className='flex w-fit cursor-pointer items-center gap-2 text-13 text-white/70'>
				<input type='checkbox' checked={earlier} onChange={(event) => setEarlier(event.target.checked)} />
				An earlier Umbrel setup is on these drives
			</label>
			<p className='text-12 leading-relaxed text-white/40'>
				Sizes go up to {Math.max(...sizesTb.hdd, 20)}TB. Umbrel Pro takes up to four SSDs. In the address, a drive can
				carry marks after its size: <code>!</code> failing its health check, <code>?</code> health unknown,{' '}
				<code>w</code> worn, <code>t</code> hot, <code>c</code> far too hot, <code>a</code> a SATA SSD, <code>b</code>{' '}
				the drive umbrelOS starts from.
			</p>
		</section>
	)
}

const addClass =
	'flex items-center gap-1 rounded-full bg-white/[0.07] px-3 py-1.5 text-13 text-white/80 outline-hidden transition-colors hover:bg-white/[0.12] focus-visible:ring-2 focus-visible:ring-white/40'
const stepClass =
	'flex size-6 items-center justify-center rounded-full bg-white/10 text-white/80 outline-hidden transition-colors hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white/40'
