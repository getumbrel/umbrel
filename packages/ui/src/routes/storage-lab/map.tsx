// Storage lab: the map. Everything umbreld can do with storage, and everything it can
// report, set beside the screen that handles it. It is the checklist the mocks were built
// against: a row without a screen is a gap. The table of states is worked out from the
// scenarios themselves, so it can't drift from what the mocks show.

import {useTranslation} from 'react-i18next'
import {TbArrowLeft} from 'react-icons/tb'
import {Link} from 'react-router-dom'

import {OnboardingBackground} from '@/components/onboarding-background'
import {getStatus} from '@/features/storage/manager/status'
import {MAX_HDD_RAIDZ1_DRIVES} from '@/features/storage/model'
import {TechTag} from '@/features/storage/parts'
import {viewPool} from '@/features/storage/state'
import {cn} from '@/lib/utils'

import {managerScenarios} from './fixtures'

// Links into the lab: an onboarding scenario, a Storage Manager scenario, or any other screen
function To({to, children}: {to: string; children: React.ReactNode}) {
	return (
		<Link
			to={to}
			className='text-white/85 underline decoration-white/25 underline-offset-2 transition-colors hover:decoration-white/70'
		>
			{children}
		</Link>
	)
}
const O = (id: string, label: string) => <To to={`/storage-lab/onboarding/${id}`}>{label}</To>
const M = (id: string, label: string) => <To to={`/storage-lab/manager/${id}`}>{label}</To>
const X = (path: string, label: string) => <To to={`/storage-lab/${path}`}>{label}</To>

const C = TechTag

// A table row. Cells are passed as arguments so each one doesn't need a key of its own.
const r = (...cells: React.ReactNode[]) => cells

function Section({
	id,
	title,
	intro,
	children,
}: {
	id: string
	title: string
	intro?: React.ReactNode
	children: React.ReactNode
}) {
	return (
		<section id={id} className='flex scroll-mt-6 flex-col gap-3 border-t border-white/10 pt-6'>
			<div className='flex flex-col gap-1'>
				<h2 className='text-17 font-semibold text-white/90'>{title}</h2>
				{intro && <p className='max-w-[720px] text-13 leading-relaxed text-white/50'>{intro}</p>}
			</div>
			{children}
		</section>
	)
}

function Table({head, rows, widths}: {head: string[]; rows: React.ReactNode[][]; widths?: string[]}) {
	return (
		<div className='overflow-x-auto rounded-17 bg-white/5'>
			<table className='w-full min-w-[640px] border-collapse text-left text-13 leading-snug'>
				<thead>
					<tr>
						{head.map((cell, index) => (
							<th
								key={cell}
								className='px-4 pt-3 pb-2 text-12 font-semibold text-white/40'
								style={{width: widths?.[index]}}
							>
								{cell}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map((row, rowIndex) => (
						<tr key={rowIndex} className='border-t border-white/[0.06] align-top'>
							{row.map((cell, index) => (
								<td
									key={index}
									className={cn('px-4 py-2.5', index === 0 ? 'font-medium text-white/85' : 'text-white/60')}
								>
									{cell}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	)
}

const toneDot = {
	protected: 'bg-white',
	unprotected: 'bg-white/40',
	healthy: 'bg-white/40',
	busy: 'bg-white/70 ring-2 ring-white/25',
	attention: 'bg-[#F5A623]',
	critical: 'bg-[#FF3434]',
} as const

const sections = [
	['principles', 'How things are shown'],
	['hardware', 'Hardware'],
	['layouts', 'Layouts and rules'],
	['setup', 'Setting up'],
	['states', 'Every state'],
	['operations', 'Every operation'],
	['fields', 'Every status field'],
	['events', 'Events'],
	['refusals', 'Every refusal'],
	['needs', 'Needs umbreld'],
	['gaps', 'Gaps in today’s UI'],
] as const

export default function StorageLabMap() {
	const {t, i18n} = useTranslation()
	// One row per scenario: what the screen says about that state, and what it offers
	const states = managerScenarios.map((scenario) => {
		const state = scenario.build()
		const view = viewPool(state)
		return {scenario, status: getStatus(state, view, t, i18n.language), hasNewDrive: view.loose.length > 0}
	})
	const groups = [...new Set(managerScenarios.map((scenario) => scenario.group))]

	return (
		<>
			<OnboardingBackground />
			<div className='relative flex min-h-svh justify-center p-4 md:p-8'>
				<div
					className='umbrel-material flex w-full max-w-[1040px] flex-col gap-6 self-start rounded-3xl p-5 md:p-8'
					style={{'--material-blur': '40px'} as React.CSSProperties}
				>
					<header className='flex flex-col gap-3'>
						<Link
							to='/storage-lab'
							className='flex w-fit items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-12 font-medium text-white/70 transition-colors hover:bg-white/20 hover:text-white'
						>
							<TbArrowLeft className='size-3.5' />
							Lab
						</Link>
						<h1 className='text-24 font-bold text-white/90 md:text-32'>From umbreld to the screen</h1>
						<p className='max-w-[720px] text-14 leading-relaxed text-white/55'>
							Everything umbreld can do with storage and everything it can report, set beside the screen that handles
							it. Read from <C>hardware/raid.ts</C>, <C>hardware/internal-storage.ts</C> and <C>user/routes.ts</C> as
							they are on staging. Links open the mock for that case. What umbreld doesn’t report is listed under{' '}
							<a href='#needs' className='underline underline-offset-2 hover:text-white'>
								Needs umbreld
							</a>
							, and nothing on the screens pretends otherwise.
						</p>
						<nav className='flex flex-wrap gap-1.5'>
							{sections.map(([id, label]) => (
								<a
									key={id}
									href={`#${id}`}
									className='rounded-full bg-white/[0.07] px-3 py-1 text-12 font-medium text-white/70 transition-colors hover:bg-white/15 hover:text-white'
								>
									{label}
								</a>
							))}
						</nav>
					</header>

					<Section
						id='principles'
						title='How things are shown'
						intro='The rules every screen follows. When a screen breaks one, that is a bug in the design.'
					>
						<div className='grid gap-x-8 gap-y-4 md:grid-cols-2'>
							{[
								[
									'One answer first',
									'Onboarding opens with the setup Umbrel would choose. Storage Manager opens with one sentence: protected, not protected, or what’s wrong. Everything else is a step in.',
								],
								[
									'One action per problem',
									'A problem names the single thing to do about it, on the button. Where a drive has to be changed by hand first, the button leads to the steps.',
								],
								[
									'The drives are the picture',
									'The tray photo on Umbrel Pro, a bay of drive rows elsewhere, annotated the way today’s tray is: a hairline outline whose colour is the drive’s state. No state uses the wallpaper’s colour. A tap opens the drive.',
								],
								[
									'Promises before names',
									'“Any one drive can fail”, not RAID-Z1. On a machine with only SSDs it says SSD. The technical name is always one step in: Compare in detail, the FailSafe sheet, Technical details.',
								],
								[
									'Every dead end explains itself',
									'Nothing is greyed out without saying why and what would change it. umbreld’s refusals are prevented where they can be. When one happens anyway, the sheet stays open with one plain sentence, Try again, and umbreld’s own words under Technical details.',
								],
								[
									'What can’t be undone is said at the moment of choosing',
									'FailSafe can’t be turned off, its level can’t be changed, acceleration can’t be removed, and several SSDs in Full Storage can never become FailSafe. A routine confirm is an ordinary button named for what it does. Red is kept for what destroys something.',
								],
							].map(([title, body]) => (
								<div key={title} className='flex flex-col gap-1'>
									<h3 className='text-14 font-medium text-white/90'>{title}</h3>
									<p className='text-13 leading-relaxed text-white/50'>{body}</p>
								</div>
							))}
						</div>
					</Section>

					<Section
						id='hardware'
						title='Hardware'
						intro='umbreld knows five kinds of machine. Two of them have storage to choose; the rest keep everything on the drive umbrelOS runs from.'
					>
						<Table
							head={['Machine', 'What umbreld knows', 'Setting up', 'Storage Manager']}
							widths={['17%', '27%', '28%', '28%']}
							rows={[
								r(
									'Umbrel Pro',
									'Four SSD slots, and which slot each SSD is in. Storage is always set up.',
									<>
										The storage step, drawn on the tray. {O('pro-4', 'Four SSDs')}, {O('pro-1', 'one')},{' '}
										{O('pro-gaps', 'gaps')}, {O('pro-none', 'none')}
									</>,
									<>
										The tray, each slot a tap away, empty slots inviting an SSD. {M('pro-failsafe', 'Protected')},{' '}
										{M('pro-one', 'one SSD')}
									</>,
								),
								r(
									'Other hardware, with hard drives',
									'Any drives besides the one umbrelOS starts from. No slots, no bays: drives are told apart by model and serial.',
									<>
										The same step, drawn as a bay. Hard drives hold the files by default and SSDs accelerate them, or
										the SSDs can be chosen instead. {O('nas-4', 'Four drives')}, {O('nas-accel', 'with SSDs')}
									</>,
									<>
										The bay, pairs drawn together, acceleration beside it. {M('nas-z1', 'One-drive')},{' '}
										{M('nas-mirror', 'pairs')}, {M('nas-accel', 'accelerated')}
									</>,
								),
								r(
									'Other hardware, SSDs only',
									'The same, with no hard drive found.',
									<>
										The same step, with SSD rows. {O('flash-2', 'Two SSDs')}, {O('flash-6', 'six')}
									</>,
									<>The bay. {M('flash-z1', 'Six SSDs')}</>,
								),
								r(
									'Other hardware, no spare drives',
									'Only the boot drive. No storage is created.',
									'No storage step: umbrelOS sets up on the drive it runs from.',
									<>Single-drive view, which explains how spare drives would be used. {X('single/pc', 'Open')}</>,
								),
								r(
									'Umbrel Home',
									'One built-in SSD.',
									'No storage step.',
									<>Single-drive view. {X('single/home', 'Open')}</>,
								),
								r(
									'Raspberry Pi',
									'A microSD card, or one external drive.',
									'Today’s choice between the two, unchanged.',
									<>Single-drive view. {X('single/pi', 'Open')}</>,
								),
								r(
									'A container',
									'A folder given by the host.',
									'No storage step.',
									<>Single-drive view. {X('single/container', 'Open')}</>,
								),
							]}
						/>
					</Section>

					<Section
						id='layouts'
						title='Layouts and rules'
						intro='Four layouts, and the rules umbreld holds them to. Each rule is either built into what the screens offer, or explained where someone runs into it.'
					>
						<Table
							head={['Layout', 'Shown as', 'Rules', 'Where the rule shows']}
							widths={['14%', '22%', '32%', '32%']}
							rows={[
								r(
									<>
										Full Storage <C>stripe</C>
									</>,
									'“Every drive is used for space. If one fails, everything is lost.”',
									'Any number of drives, of one kind. Grows by any drive of that kind.',
									<>
										Hard drives and SSDs never share one storage: {O('nas-mostly-ssd', 'one hard drive, four SSDs')},{' '}
										{M('flash-hdd', 'a hard drive beside SSD storage')}
									</>,
								),
								r(
									<>
										FailSafe <C>RAID-Z1</C>
									</>,
									'“Any one drive can fail”',
									`Two or more drives. Hard drives: up to ${MAX_HDD_RAIDZ1_DRIVES}. Uses the smallest drive’s size on every drive. Grows one drive at a time, each at least that size.`,
									<>
										{O('nas-8', 'Eight drives')} leaves two out, {M('nas-limit', 'a seventh')} can’t join.{' '}
										{O('pro-mixed', 'Mixed sizes')}, {O('nas-small-one', 'a small drive left out')},{' '}
										{M('nas-too-small', 'too small to add')}
									</>,
								),
								r(
									<>
										FailSafe <C>RAID-Z2</C>
									</>,
									'“Any two drives can fail”',
									'Hard drives only, three or more. Same size rule and growth as above.',
									<>
										Not offered for SSDs. {O('nas-2', 'Two drives')} shows it needs three, {O('nas-6', 'six')}{' '}
										recommends it
									</>,
								),
								r(
									<>
										FailSafe <C>Mirror</C>
									</>,
									'“One drive in each pair can fail”',
									'Hard drives only, in pairs. Each pair uses its smaller drive’s size. Grows a pair at a time.',
									<>
										{O('nas-3', 'Three drives')} leaves one out, {O('nas-pairs', 'two sizes in pairs')} recommends it,{' '}
										{M('nas-mirror-one', 'one new drive waits for a second')}
									</>,
								),
								r(
									'SSD Acceleration',
									'“Apps launch faster and folders load instantly”',
									'Hard drive storage only. Exactly one SSD in Full Storage, exactly two in FailSafe. Can’t be removed or added to.',
									<>
										{O('nas-accel-one', 'One SSD with FailSafe')}, {O('nas-accel-three', 'three SSDs')},{' '}
										{M('nas-ssd-one', 'one short later')}, {M('nas-accel-extra', 'a third SSD')}
									</>,
								),
								r(
									'The system drive',
									'“umbrelOS runs from this drive”',
									'Never usable for storage.',
									<>
										Listed, never offered: {O('nas-boot', 'setting up')}, {M('nas-boot', 'Storage Manager')}
									</>,
								),
							]}
						/>
					</Section>

					<Section
						id='setup'
						title='Setting up'
						intro={
							<>
								Onboarding ends in one call, <C>user.register</C>. Each of its storage arguments is one decision on the
								storage step, already made the way Umbrel would make it.
							</>
						}
					>
						<Table
							head={['Argument', 'Decision', 'What Umbrel chooses', 'Changed in']}
							widths={['20%', '20%', '36%', '24%']}
							rows={[
								r(
									<C>raidType</C>,
									'FailSafe or Full Storage',
									'FailSafe when it costs only what protection has to cost. With mixed sizes that would leave space unusable, Full Storage, as today, and neither is marked as recommended.',
									<>The two cards. {O('pro-2', 'Two SSDs')}</>,
								),
								r(
									<C>failsafeLayout</C>,
									'How much protection',
									'A mirrored pair for two hard drives, as umbreld’s own default is. One-drive from three to five, two-drive from six, and mirrored pairs when they give a quarter more space.',
									<>Protection. {O('nas-4', 'Four drives')}</>,
								),
								r(
									<C>raidDevices</C>,
									'Which drives',
									'Every healthy drive of the kind that holds the files, except one that would cost more space than it adds. Both stay one tap away.',
									<>Drives. {O('nas-small-one', 'Three 8TB and one 2TB')}</>,
								),
								r(
									<C>acceleratorDevices</C>,
									'SSD Acceleration',
									'On when the SSDs for it are there: the largest matching pair, or the largest single SSD.',
									<>SSD Acceleration. {O('nas-accel-mismatch', 'A 1TB and a 2TB SSD')}</>,
								),
							]}
						/>
						<Table
							head={['Around the storage step', 'umbreld', 'Screen']}
							widths={['26%', '34%', '40%']}
							rows={[
								r(
									'Finding drives',
									<C>hardware.internalStorage.getDevices</C>,
									<>
										The scan, then the storage step, or {O('pro-none', 'nothing found')}. A drive failing its health
										check is {O('pro-failing', 'left out')} unless it is {O('pro-only-failing', 'all there is')}, a worn
										one is {O('pro-worn', 'flagged')}, and one that doesn’t report its health reads{' '}
										{O('nas-unknown-health', 'Unknown')}.
									</>,
								),
								r(
									'An earlier Umbrel setup on the drives',
									<>
										<C>hardware.raid.hasRecoverableInstall</C> <C>recoverExistingInstall</C>
									</>,
									<>
										Welcome back, before anything is erased. {O('pro-restore', 'Umbrel Pro')},{' '}
										{O('nas-restore', 'hard drives')}. Setting up as new asks once, where the drives are erased.
										Failure, a slow restart and a lost connection are in the Simulate menu.
									</>,
								),
								r(
									'Waiting for the storage',
									<C>hardware.raid.checkInitialRaidSetupStatus</C>,
									'Setting up your storage. Still working, connection lost with Return to start, failed with a retry, and failed for good are in the Simulate menu.',
								),
								r('Changing drives first', <C>system.shutdown</C>, 'Add or remove drives, at the foot of the step.'),
							]}
						/>
					</Section>

					<Section
						id='states'
						title='Every state'
						intro='What Storage Manager says about each state the storage can be in, and the action it leads with. Worked out from the scenarios themselves.'
					>
						{groups.map((group) => (
							<div key={group} className='flex flex-col gap-1.5'>
								<h3 className='px-1 text-12 font-semibold text-white/40'>{group}</h3>
								<Table
									head={['State', 'Storage Manager says', 'It offers']}
									widths={['36%', '36%', '28%']}
									rows={states
										.filter((entry) => entry.scenario.group === group)
										.map(({scenario, status, hasNewDrive}) =>
											r(
												M(scenario.id, scenario.title),
												<span key='status' className='flex items-center gap-2 text-white/80'>
													<span className={cn('size-2 shrink-0 rounded-full', toneDot[status.tone])} />
													{status.title}
												</span>,
												status.actions?.map((action) => action.label).join(' · ') ??
													(hasNewDrive ? 'On the new drive’s card' : 'Nothing to do'),
											),
										)}
								/>
							</div>
						))}
					</Section>

					<Section
						id='operations'
						title='Every operation'
						intro='Each thing umbreld can be asked to do to the storage, and where it is asked from.'
					>
						<Table
							head={['umbreld', 'In Storage Manager', 'Mocks']}
							widths={['28%', '36%', '36%']}
							rows={[
								r(
									<C>hardware.raid.addDevice</C>,
									'A new drive’s card: Add to storage, or Add without FailSafe. RAID-Z grows in the background, one drive at a time. Full Storage grows at once.',
									<>
										{M('pro-new', 'A new SSD')}, {M('nas-bigger', 'a bigger drive')},{' '}
										{M('nas-z1-three-new', 'three at once')}, {M('nas-expanding', 'while it runs')},{' '}
										{M('nas-grew', 'just after')}
									</>,
								),
								r(
									<C>hardware.raid.addMirror</C>,
									'Two new drives’ card: Add as a pair.',
									<>{M('nas-mirror-two', 'Two new drives')}</>,
								),
								r(
									<C>hardware.raid.addAccelerator</C>,
									'New SSDs’ card: Turn on SSD Acceleration.',
									<>
										{M('nas-ssds-new', 'Two new SSDs')}, {M('nas-full-accel', 'one, in Full Storage')}
									</>,
								),
								r(
									<C>hardware.raid.replaceDevice</C>,
									'Three things with one call. Replace: a failed drive, onto a new one. Swap: a working drive, for a bigger one, which stays connected until the new one holds everything. Repair: a drive the storage can’t use, where it is.',
									<>
										{M('pro-failed-spare', 'Replace')}, {M('swap-failsafe-ready', 'swap')},{' '}
										{M('nas-unusable', 'repair')}, {M('nas-rebuilding', 'while it runs')}
									</>,
								),
								r(
									<C>hardware.raid.transitionToFailsafeRaidz</C>,
									'Turn on FailSafe, from a single drive. Copies to the new drives, restarts, then adds the original drive.',
									<>
										{M('pro-second', 'A second SSD')}, {M('nas-single-new', 'two new drives')},{' '}
										{M('nas-transition', 'copying')}, {M('nas-restarting', 'restarting')},{' '}
										{M('nas-finishing', 'protecting')}, {M('nas-switched', 'just after')}
									</>,
								),
								r(
									<C>hardware.raid.transitionToFailsafeMirror</C>,
									'Turn on FailSafe, from several hard drives. Every drive is paired with a new drive at least its own size, and nothing restarts.',
									<>
										{M('nas-full-new', 'Enough new drives')}, {M('nas-full-mixed-new', 'mixed sizes')},{' '}
										{M('nas-full-short', 'some short')}, {M('nas-mirroring', 'while it runs')}
									</>,
								),
								r(
									<C>hardware.raid.scrub</C>,
									'Storage check: Check now. It also runs by itself every 30 days.',
									<>
										{M('nas-check', 'Running')}, {M('nas-damaged', 'damaged data')}
									</>,
								),
								r(
									'Changing a drive by hand',
									'No call. The steps for the machine: the new drive beside the old one where there is room, in place where there isn’t, or back up and start over.',
									<>
										{M('swap-pro-free', 'Beside it')}, {M('swap-pro-full', 'in place')},{' '}
										{M('swap-failsafe', 'either, on other hardware')}, {M('swap-full-none', 'start over')},{' '}
										{M('swap-blocked', 'not now')}
									</>,
								),
								r(
									<>
										<C>checkRaidMountFailure</C> <C>checkRaidMountFailureDevices</C>
									</>,
									'Before login: your storage couldn’t start, with the drives that aren’t responding. Worded without the storage mode, which umbreld doesn’t report here.',
									<>
										{X('start/pro', 'Umbrel Pro')}, {X('start/nas', 'hard drives')}
									</>,
								),
							]}
						/>
					</Section>

					<Section
						id='fields'
						title='Every status field'
						intro={
							<>
								What <C>hardware.raid.getStatus</C> and <C>hardware.internalStorage.getDevices</C> return, and where
								each field ends up. Raw values only appear under Technical details.
							</>
						}
					>
						<Table
							head={['Field', 'Becomes']}
							widths={['34%', '66%']}
							rows={[
								r(
									<>
										<C>exists</C> <C>name</C>
									</>,
									<>
										No storage: the single-drive view. A name without storage, or a storage that isn’t running:{' '}
										{X('single/unidentified', 'can’t be identified')}. No answer at all:{' '}
										{X('single/unreadable', 'can’t be read')}.
									</>,
								),
								r(
									<>
										<C>raidType</C> <C>topology</C> <C>raidzParity</C>
									</>,
									'The FailSafe row and its sheet, as a promise. The technical name sits beside it in a tag.',
								),
								r(
									<C>status</C>,
									<>
										The sentence at the top: Protected, Not protected, what’s wrong, or{' '}
										{M('nas-offline', 'Storage is offline')}.
									</>,
								),
								r(
									<C>devices[].status</C>,
									<>
										A drive’s state in the picture. With the drive list, a member that is gone (
										{M('nas-missing', 'Not detected')}) is told from one that is attached but not usable (
										{M('nas-unusable', 'Can’t be used')}), one that has {M('nas-z1-failed', 'Failed')}, and one the
										storage still uses but no longer trusts ({M('nas-faulty', 'Too many errors')}).
									</>,
								),
								r(
									<>
										<C>readErrors</C> <C>writeErrors</C> <C>checksumErrors</C>
									</>,
									<>{M('nas-errors', 'A drive is reporting errors')}: amber on the drive, the count in its sheet.</>,
								),
								r(
									<>
										<C>usedSpace</C> <C>freeSpace</C> <C>usableSpace</C> <C>totalSpace</C>
									</>,
									'Used and free, in the status card. Available, FailSafe and Unusable, in the bar under the drives.',
								),
								r(
									<C>dataErrors</C>,
									<>
										{M('nas-damaged', 'Some of your data is damaged')}, with the count. It is a count of errors, not a
										list of files.
									</>,
								),
								r(<C>mirrors</C>, 'Which drives are drawn as a pair, with the shield between them.'),
								r(
									<C>accelerator</C>,
									<>
										The SSD Acceleration bay, row and sheet. Its free space is the{' '}
										{M('nas-accel-full', 'space for small files')}.
									</>,
								),
								r(
									<>
										<C>expansion</C> <C>rebuild</C> <C>replace</C>
									</>,
									'Adding a drive, or Rebuilding. One number per task. It sits on the drive itself when the browser that started the task is the one looking.',
								),
								r(
									<C>scrub</C>,
									'The Storage check row: its progress while it runs, and “Runs every 30 days” otherwise.',
								),
								r(
									<C>failsafeTransitionStatus</C>,
									<>
										Copy, Restart, Protect. An error becomes {M('nas-transition-failed', 'FailSafe wasn’t turned on')}{' '}
										or {M('nas-partial', 'FailSafe is only partly on')}.
									</>,
								),
								r(
									<>
										<C>smartStatus</C> <C>temperature</C> <C>lifetimeUsed</C>
									</>,
									<>
										{M('nas-warning', 'May fail soon')}, {M('pro-hot', 'running hot')},{' '}
										{M('pro-critical', 'far too hot')}, {M('pro-worn', 'nearly worn out')}, and the readings in each
										drive’s sheet, in the temperature unit from Settings. A reading the drive doesn’t report isn’t
										shown.
									</>,
								),
								r(
									<>
										<C>slot</C> <C>isSystemDrive</C>
									</>,
									'Where an SSD sits in Umbrel Pro’s tray. Which drive is listed as the system drive.',
								),
							]}
						/>
					</Section>

					<Section
						id='events'
						title='Events'
						intro='What umbreld announces while it works. The lab’s clock stands in for them.'
					>
						<Table
							head={['Event', 'Becomes']}
							widths={['40%', '60%']}
							rows={[
								r(
									<>
										<C>raid:expansion-progress</C> <C>raid:rebuild-progress</C> <C>raid:replace-progress</C>
									</>,
									<>
										The ring around the status mark, and the task’s one number. The island says the same step and the
										same number: {X('notices', 'How you find out')}.
									</>,
								),
								r(<C>raid:failsafe-transition-progress</C>, 'Copy, Restart, Protect.'),
								r(<C>raid:scrub-progress</C>, 'The Storage check row. Routine, so it never takes over the status.'),
								r(
									<>
										<C>raid:status-change</C> <C>system:disk:change</C>
									</>,
									'A drive failing, going missing or being plugged in while Storage Manager is open. In the lab: the Simulate menu.',
								),
								r(
									<>
										Notification <C>raid-scrub-errors</C>
									</>,
									<>
										Opens Storage Manager on {M('nas-damaged', 'damaged data')}, in the same words:{' '}
										{X('notices', 'How you find out')}.
									</>,
								),
							]}
						/>
					</Section>

					<Section
						id='refusals'
						title='Every refusal'
						intro='The ways umbreld says no. None of these messages should ever reach a person: each is either made impossible to ask for, or said in plain words before the button is pressed.'
					>
						<Table
							head={['umbreld says', 'The screen does']}
							widths={['44%', '56%']}
							rows={[
								r(
									'Cannot start … while … is in progress',
									<>
										One change at a time. A new drive’s card names the task in the way and how far along it is:{' '}
										{M('nas-expanding', 'a drive is being added')}, {M('nas-check', 'a storage check')}.
									</>,
								),
								r(
									'Cannot replace a device while a RAID rebuild is in progress',
									'Replace waits for the rebuild. A storage check is different: umbreld stops it for a repair, and the sheet says so.',
								),
								r(
									'Cannot mix SSDs and HDDs in the same RAID array',
									<>
										{M('flash-hdd', 'A hard drive beside SSD storage')} can’t join, and its card says why. An SSD beside
										hard drives is offered as acceleration.
									</>,
								),
								r(
									`HDD raidz1 arrays are limited to ${MAX_HDD_RAIDZ1_DRIVES} devices`,
									<>{M('nas-limit', 'The limit, and what to do instead')}: swap drives for larger ones.</>,
								),
								r(
									'A new drive smaller than the storage’s drives (refused by ZFS)',
									<>{M('nas-too-small', 'Too small')}, with the size it would need to be.</>,
								),
								r(
									'addDevice is not supported for mirror failsafe mode',
									<>{M('nas-mirror-one', 'One new drive')} waits for a second. Only a pair is ever offered.</>,
								),
								r(
									'Failsafe mode requires exactly two SSDs for the accelerator',
									<>{M('nas-ssd-one', 'One short of a pair')}.</>,
								),
								r(
									'RAID array already has an accelerator',
									<>{M('nas-accel-extra', 'A third SSD')} can only wait as a spare.</>,
								),
								r(
									'Can only transition single-disk arrays',
									<>
										{M('pro-full-multi', 'Several SSDs in Full Storage')}: FailSafe can’t be turned on, with the honest
										reason. Several hard drives are paired with new drives instead.
									</>,
								),
								r(
									'Need exactly N mirror pair(s)',
									<>{M('nas-full-short', 'Not enough new drives yet')}, and what each pair still needs.</>,
								),
								r(
									'Cannot transition to a device smaller than the current device',
									'Too small, on the new drive’s card, with the size FailSafe needs.',
								),
								r(
									'Transitioning to failsafe with an accelerator requires an additional SSD',
									<>
										{M('nas-accel-single-new', 'One accelerated hard drive')}: FailSafe takes the second SSD too.{' '}
										{M('nas-full-accel-new', 'Without one')}, the card and the sheet both say it is missing.
									</>,
								),
								r(
									'Cannot add an accelerator while the storage array is only partially protected',
									<>{M('nas-partial', 'FailSafe is only partly on')}: finish that first.</>,
								),
								r(
									'Cannot replace a healthy device with itself',
									<>Repair is only offered for {M('nas-unusable', 'a drive that can’t be used')}.</>,
								),
								r(
									'Can only transition from storage mode',
									'With FailSafe on, its sheet describes it and offers nothing to turn on.',
								),
								r('Cannot use the system drive for RAID', 'The system drive is listed and never selectable.'),
								r(
									'Failsafe mode requires at least two devices',
									<>{O('pro-1', 'One SSD')}: the FailSafe card says what it needs.</>,
								),
								r(
									'Any other refusal, at the moment of asking',
									'The sheet stays open: one plain sentence, Try again, and umbreld’s words under Technical details. In the lab: Simulate, Refuse the next request.',
								),
								r(
									'Cannot set up RAID because the existing storage failed to mount',
									<>{X('start/pro', 'Your storage couldn’t start')}, before login.</>,
								),
								r(
									'Taking out a drive the storage is leaning on (today’s own guard)',
									<>{M('swap-blocked', 'Leave this drive connected')}.</>,
								),
							]}
						/>
					</Section>

					<Section
						id='needs'
						title='Needs umbreld'
						intro='What the screens would like to say and can’t, because umbreld doesn’t report or allow it today. This branch only changes the UI, so each one is designed around, and what would close it is named here.'
					>
						<Table
							head={[
								'What’s missing',
								'What umbreld gives today',
								'What the screen does instead',
								'What would close it',
							]}
							widths={['20%', '26%', '30%', '24%']}
							rows={[
								r(
									'Which files are damaged',
									<>
										<C>dataErrors</C>, a count of errors. No paths, and an error isn’t always one file.
									</>,
									<>{M('nas-damaged', 'The count')}, and a lead to Backups.</>,
									'The affected paths in getStatus.',
								),
								r(
									'When the storage check last ran, and when it runs next',
									<>
										<C>scrub</C> holds state, progress and errors, and is gone after any rebuild. The next run is stored
										and not returned.
									</>,
									'“Runs every 30 days”, and progress while one is running.',
									'The finish time and the next run in getStatus.',
								),
								r(
									'Whether storage that won’t start had FailSafe',
									<>
										Before login, <C>checkRaidMountFailureDevices</C> returns each drive’s name and whether it answered.
									</>,
									<>{X('start/nas', 'Worded without the mode')}, with what each mode would mean.</>,
									'The mode and level in that call.',
								),
								r(
									'When a long task finished',
									'Progress events while it runs, then nothing. A finished expansion stays “finished” forever, with no time.',
									<>{M('nas-switched', 'A moment')} for a browser that was open when it ended. Nothing later.</>,
									'A finish time per task, or a notification when one ends.',
								),
								r(
									'Which drives a running task involves',
									'That a rebuild, an expansion or a switch is running and how far along. Not which drives.',
									<>
										The browser that started it remembers and shows it on the drives. Any other shows{' '}
										{M('nas-transition-elsewhere', 'the task without them')}.
									</>,
									'The member ids on replace, rebuild, expansion and the switch.',
								),
								r(
									'Which level a switch is heading for',
									'The storage stays a single drive until the restart, so one- and two-drive protection look alike until then.',
									'Named after the restart, or straight away in the browser that started it.',
									'The target layout on failsafeTransitionStatus.',
								),
								r(
									'Which slot a missing SSD was in',
									'A slot only for SSDs that are present.',
									<>{M('pro-missing', 'Listed under the tray')}, by model and serial.</>,
									'The last known slot for each member.',
								),
								r(
									'Which drives hold an earlier setup',
									<>
										<C>hasRecoverableInstall</C>, yes or no.
									</>,
									<>{O('nas-restore', '“Found on your drives”')}, never on a particular one.</>,
									'The drives it was found on.',
								),
								r(
									'Clearing the damaged-data warning once files are restored',
									'Nothing clears the count. ZFS keeps it until later clean checks.',
									'“Clears after the next storage check that finds no errors.”',
									'A way to clear it, or a check that runs after a restore.',
								),
								r(
									'Adding a drive while a storage check runs',
									'Refused. Only a replacement stops a check.',
									<>{M('nas-check', 'Names the check and its progress')} as the reason to wait.</>,
									'The same treatment a replacement gets.',
								),
								r(
									'Finishing a FailSafe that is only partly on',
									'Refused: only an unmirrored storage can be switched.',
									<>{M('nas-partial', 'Back up, reset and restore')}, with support named as the other way.</>,
									'A retry that pairs the drives that were left out.',
								),
								r(
									'Protecting an acceleration SSD that was left on its own',
									'Refused: acceleration can’t take an SSD once it is on, and a switch only starts from one unprotected drive.',
									<>{M('nas-accel-exposed', 'Partly on')}, never “Protected”, with the same way out.</>,
									'A way to give the SSD its mirror.',
								),
								r(
									'What a storage is made of when none of its drives can be seen',
									'Whether a drive is an SSD or a hard drive is only known while it is attached. A drive’s name is its model and serial number.',
									'Umbrel Pro is taken to be SSDs. Elsewhere the layout decides where only hard drives can have it, and otherwise the drives are listed and nothing is managed.',
									'The kind of drive on getStatus.',
								),
								r(
									'How large a missing acceleration SSD was',
									'The size the storage remembers for each of its drives, but not for acceleration SSDs.',
									'The size of the SSD it was mirrored with.',
									'The same size on the acceleration SSDs.',
								),
								r(
									'Why umbrelOS is restarting',
									'The restart of a switch happens by itself, about 11 seconds after the copy ends.',
									<>
										{M('nas-restarting', 'The reason on the restarting screen')}, for a browser that saw the switch
										reach its restart.
									</>,
									'The reason on the system status.',
								),
							]}
						/>
					</Section>

					<Section
						id='gaps'
						title='Gaps in today’s UI'
						intro='Found while reading the code for this map, not from a real array. Each is closed in the mocks.'
					>
						<Table
							head={['Today', 'In the mocks']}
							widths={['50%', '50%']}
							rows={[
								r(
									'Hard drive onboarding only offers mirrored pairs, though umbreld takes one- and two-drive protection.',
									<>All three, by what they promise. {O('nas-4', 'Four drives')}</>,
								),
								r(
									'Every eligible drive is always used, though umbreld takes any selection.',
									<>Drives, with Umbrel’s own pick already made. {O('nas-all-different', 'Four sizes')}</>,
								),
								r(
									'Storage Manager treats FailSafe on hard drives as pairs, so a RAID-Z array would list no drives, and its copy says half the space is reserved.',
									<>One picture for every layout. {M('nas-z2', 'Two-drive protection')}</>,
								),
								r(
									'Acceleration with FailSafe needs two SSDs of the same size, though umbreld takes any two.',
									<>
										A mismatched pair is allowed, and says what it costs. {O('nas-accel-mismatch', 'A 1TB and a 2TB')}
									</>,
								),
								r(
									'A FailSafe switch that restarts gives one number, with no warning that umbrelOS will go away.',
									<>Copy, Restart, Protect. {M('nas-restarting', 'Restarting')}</>,
								),
								r(
									'A drive running hot or wearing out is only visible inside its health dialog.',
									<>
										It reaches the status. {M('pro-hot', 'Hot')}, {M('pro-worn', 'worn')}
									</>,
								),
								r(
									'After a RAID-Z array grows, used space rises with no explanation.',
									<>One sentence under the drives. {M('nas-grew', 'Just after a drive was added')}</>,
								),
								r(
									'Swapping a working drive in FailSafe always pulls it first, leaving the storage unprotected for the whole rebuild.',
									<>The new drive goes in first where there is room. {M('swap-pro-free', 'A free slot')}</>,
								),
								r(
									'“Protected” and a drive in use take the wallpaper’s colour, so on a red wallpaper a healthy drive looks failed.',
									'State colours are fixed: white in use, teal new, amber attention, red failed. Try the wallpaper colours in Simulate.',
								),
								r(
									'The island, the toast and Storage Manager each word the same event differently, and the island shows a different number.',
									<>One sentence and one number everywhere. {X('notices', 'How you find out')}</>,
								),
							]}
						/>
					</Section>
				</div>
			</div>
		</>
	)
}
