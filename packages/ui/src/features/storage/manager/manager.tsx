// Storage Manager. It answers two questions before anything else: is my data safe, and how
// much room do I have. The drives are drawn beside the answer, each one a tap away from its
// details, and every problem comes with the one thing to do about it. What can be changed
// (FailSafe, acceleration, the storage check, the technical detail) sits in rows underneath.
//
// It shows a StorageState and asks for StorageActions. Where the state comes from and where
// the actions go is up to whoever renders it: umbreld in Settings, a pretend one in the lab.

import {useState} from 'react'
import {useTranslation} from 'react-i18next'
import {TbPlus} from 'react-icons/tb'

import {cn} from '@/lib/utils'

import {
	AccelBay,
	ArtSection,
	DriveArt,
	DriveTone,
	DriveView,
	SpaceBar,
	StatusBadge,
	StorageArt,
	UnderTray,
} from '../art'
import {Drive, DriveKind, formatSize, GB, troubleOf} from '../model'
import {ActionButton, Disclosure, DriveLine, focusRing, ProgressBar, Row, Rows, Window} from '../parts'
import {blockedSentence, driveOfSize, promise, troubleNote} from '../phrases'
import {
	accelExposed,
	failsafeStep,
	fullness,
	getOffers,
	isSwitchTarget,
	Member,
	NEARLY_FULL,
	newDriveKinds,
	PoolView,
	StorageState,
	viewPool,
} from '../state'
import {forKind, SsdWords, useStorageTranslation} from '../words'
import {offerLabel, StorageManagerProps, Timeline, UsbDrives} from './shared'
import {Sheets} from './sheets'
import {getStatus, Sheet} from './status'

export function StorageManager(props: StorageManagerProps) {
	const {state, onClose} = props
	const {t: plainT, i18n} = useTranslation()
	// Storage made of SSDs is told about SSDs, here and in everything beneath
	const ssd = state.pool.kind === 'ssd'
	const t = forKind(plainT, state.pool.kind)
	const [sheet, setSheet] = useState<Sheet>(null)
	const view = viewPool(state)
	const isPro = state.device === 'pro'
	const {storage, accel, others, pairs} = buildViews(state, view, t)
	const offline = view.status === 'offline'
	const newKinds = offline ? [] : newDriveKinds(view)
	const hasNew = newKinds.length > 0
	const openDrive = (id: string) => setSheet({type: 'drive', id})
	const addLabel = t(`storage-mgr.action.add.${state.pool.kind}`)

	return (
		<SsdWords ssd={ssd}>
			<Window title={t('storage-manager')} onClose={onClose}>
				{/* A phone reads straight down: the answer, what to do with a new drive, the drives, then
				    what can be changed. A wider window puts the drives beside all of it: at their full
				    size on a desktop, and on a tablet in two sides that are each about a phone wide. */}
				<div
					className={cn(
						'grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-x-8 two-up:gap-y-5 two-up:max-lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] two-up:max-lg:gap-x-6',
						hasNew ? 'two-up:grid-rows-[auto_auto_1fr]' : 'two-up:grid-rows-[auto_1fr]',
					)}
				>
					<StatusCard {...props} view={view} open={setSheet} locale={i18n.language} />

					{hasNew && (
						<div className='flex min-w-0 flex-col gap-2 two-up:col-start-1 two-up:row-start-2'>
							{newKinds.map((kind) => (
								<NewDrives key={kind} state={state} view={view} kind={kind} open={setSheet} locale={i18n.language} />
							))}
						</div>
					)}

					<div
						className={cn(
							'flex min-w-0 flex-col items-center gap-3 two-up:col-start-2 two-up:row-start-1',
							hasNew ? 'two-up:row-span-3' : 'two-up:row-span-2',
							isPro ? '-mr-6 md:-mt-6 md:-mr-8 lg:w-[392px] two-up:max-md:-mt-3' : 'lg:w-[400px]',
						)}
					>
						<ArtSection
							title={(accel.length > 0 || others.length > 0) && !isPro ? t('storage-ui.storage') : undefined}
							className={cn(isPro && 'max-w-[392px] self-end')}
						>
							<StorageArt
								device={state.device}
								drives={storage}
								pairs={pairs}
								onPick={openDrive}
								onEmptySlot={offline ? undefined : () => setSheet({type: 'install'})}
								footer={
									offline ? undefined : (
										<button
											type='button'
											onClick={() => setSheet({type: 'install'})}
											className={cn(
												'flex h-11 w-full shrink-0 items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/15 text-13 font-medium text-white/50 transition-colors hover:border-white/30 hover:text-white/85',
												focusRing,
											)}
										>
											<TbPlus className='size-4' strokeWidth={2.5} />
											{addLabel}
										</button>
									)
								}
							/>
							{/* The bar sums these drives up, so it stays with them, above any part that follows */}
							{!isPro && (
								<div className='flex w-full flex-col items-center gap-3 px-2 pt-2 empty:hidden'>
									{!offline && <SpaceBar capacity={view.capacity} className='max-w-[340px]' />}
									<DriveNotes state={state} view={view} />
								</div>
							)}
						</ArtSection>
						{/* Under Umbrel Pro's tray the bar is as wide as its four slots, wherever the tray
						    stops growing */}
						{isPro && (
							<UnderTray className='max-w-[392px] self-end'>
								{!offline && <SpaceBar capacity={view.capacity} />}
								<DriveNotes state={state} view={view} />
							</UnderTray>
						)}
						<AccelBay drives={accel} onPick={openDrive} />
						{others.length > 0 && (
							<ArtSection title={t('storage-mgr.others')} className={cn('mt-2', isPro && 'pr-6 md:pr-8')}>
								<Rows>
									{others.map((entry) => (
										<button
											key={entry.drive.id}
											type='button'
											onClick={() => openDrive(entry.drive.id)}
											className='text-left outline-hidden transition-colors hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-inset'
										>
											<DriveLine drive={entry.drive} tone={entry.tone} detail={entry.detail} />
										</button>
									))}
								</Rows>
							</ArtSection>
						)}
					</div>

					<div
						className={cn(
							'flex min-w-0 flex-col gap-5 two-up:col-start-1',
							hasNew ? 'two-up:row-start-3' : 'two-up:row-start-2',
						)}
					>
						<Settings state={state} view={view} open={setSheet} />
						{props.usb && <UsbDrives {...props.usb} />}
					</div>
				</div>
			</Window>

			<Sheets {...props} view={view} sheet={sheet} setSheet={setSheet} />
		</SsdWords>
	)
}

// ---------------------------------------------------------------------------
// Status: one sentence, one action
// ---------------------------------------------------------------------------

const statusSurface = {
	protected: 'border-transparent bg-white/5',
	unprotected: 'border-transparent bg-white/5',
	healthy: 'border-transparent bg-white/5',
	busy: 'border-transparent bg-white/5',
	attention: 'border-[#F5A623]/30 bg-[#F5A623]/[0.07]',
	critical: 'border-[#FF3434]/35 bg-[#FF3434]/[0.08]',
} as const

const formatUsed = (bytes: number) =>
	bytes < 1000 * GB ? `${Math.max(1, Math.round(bytes / GB))}GB` : formatSize(bytes)

function StatusCard({
	state,
	view,
	open,
	run,
	onOpenBackups,
	locale,
}: StorageManagerProps & {view: PoolView; open: (sheet: Sheet) => void; locale: string}) {
	const {t} = useStorageTranslation()
	const status = getStatus(state, view, t, locale)
	const {capacity} = view
	const full = fullness(state, view)
	const offline = view.status === 'offline'
	const [starting, setStarting] = useState(false)

	return (
		<section
			className={cn(
				'flex flex-col gap-4 rounded-24 border p-5 transition-colors duration-500 two-up:col-start-1 two-up:row-start-1',
				statusSurface[status.tone],
			)}
		>
			<div className='flex items-start gap-4'>
				<StatusBadge tone={status.tone} progress={status.progress} />
				<div className='flex min-w-0 flex-1 flex-col gap-1'>
					<h2 aria-live='polite' className='text-[19px] leading-tight font-semibold text-white'>
						{status.title}
					</h2>
					<p className='text-14 leading-snug text-white/60'>{status.body}</p>
					{status.detail && (
						<div className='mt-1'>
							<Disclosure summary={t('storage-ui.technical-details')}>
								<code className='text-12 break-words text-white/55'>{status.detail}</code>
							</Disclosure>
						</div>
					)}
					{status.actions && (
						<div className='mt-2 flex flex-wrap gap-2'>
							{status.actions.map((action) => (
								<ActionButton
									key={action.label}
									variant={action.variant ?? 'default'}
									disabled={starting}
									onClick={async () => {
										if (action.backups) return onOpenBackups()
										if (!action.run) return open(action.sheet ?? null)
										setStarting(true)
										// A refusal shows in the sheet this action belongs to
										await run(action.run).catch(() => open(action.sheet ?? {type: 'check'}))
										setStarting(false)
									}}
								>
									{action.label}
								</ActionButton>
							))}
						</div>
					)}
				</div>
			</div>

			{status.step !== undefined && <Timeline current={status.step} progress={status.progress} />}
			{status.progress !== undefined && status.step === undefined && (
				<div className='flex items-center gap-3'>
					<ProgressBar value={status.progress} label={status.title} />
					<span className='w-9 shrink-0 text-right text-13 font-medium text-white/80 tabular-nums'>
						{Math.floor(status.progress)}%
					</span>
				</div>
			)}
			{status.resumes && <p className='-mt-1 text-12 leading-snug text-white/45'>{t('storage-mgr.status.resumes')}</p>}

			{!offline && (
				<div className='flex flex-col gap-2 border-t border-white/[0.07] pt-4'>
					<div className='flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-13 text-white/50'>
						<span className='font-medium text-white/85'>
							{t('storage-mgr.used', {used: formatUsed(state.pool.used)})}
						</span>
						<span>{t('storage-mgr.free-of', {free: formatSize(view.free), total: formatSize(capacity.usable)})}</span>
					</div>
					<div className='flex h-2 w-full overflow-hidden rounded-full bg-white/10' aria-hidden>
						<div
							className={cn(
								'h-full rounded-full transition-[width] duration-500 ease-out',
								full >= NEARLY_FULL ? 'bg-[#F5A623]' : 'bg-white/85',
							)}
							style={{width: `${full * 100}%`}}
						/>
					</div>
				</div>
			)}
		</section>
	)
}

// ---------------------------------------------------------------------------
// New drives
// ---------------------------------------------------------------------------

// One card for the new drives of a kind: what they are, the best thing to do with them, and
// the buttons for it
function NewDrives({
	state,
	view,
	kind,
	open,
	locale,
}: {
	state: StorageState
	view: PoolView
	kind: DriveKind
	open: (sheet: Sheet) => void
	locale: string
}) {
	const {t: storageT} = useStorageTranslation()
	// New SSDs are spoken of as SSDs, also where they join hard drives to accelerate them
	const t = forKind(storageT, kind)
	const drives = view.loose.filter((drive) => drive.kind === kind)
	const offers = getOffers(state, kind)
	const main = offers.find((offer) => offer.primary) ?? offers[0]
	if (!main) return null
	// The main offer leads. A repair has no button here: the status above already has it.
	const usable = offers
		.filter((offer) => !offer.blocked && offer.id !== 'replace')
		.sort((a, b) => Number(!!b.primary) - Number(!!a.primary))
	const from = formatSize(view.capacity.usable)
	const list = (sizes: number[]) =>
		new Intl.ListFormat(locale, {style: 'long', type: 'conjunction'}).format(sizes.map(formatSize))
	const replaced = main.memberId ? view.driveOf(main.memberId) : undefined

	let sentence: string
	if (main.blocked) sentence = blockedSentence(t, main.blocked, kind, locale)
	// The only drive there is for it fails its own health check: said here, before it is chosen
	else if (main.lastResort) sentence = t(`storage-mgr.replace.last-resort.${kind}`)
	else if (main.id === 'replace')
		sentence = replaced?.slot
			? t('storage-mgr.new.replace.slot', {slot: replaced.slot})
			: t(`storage-mgr.new.replace.${kind}`)
	else if (main.id === 'failsafe') sentence = t('storage-mgr.new.failsafe', {count: drives.length})
	else if (main.id === 'accelerate') sentence = t('storage-mgr.new.accelerate', {count: main.takes})
	else if (main.id === 'pair') sentence = t('storage-mgr.new.pair', {from, to: formatSize(main.after ?? 0)})
	else if (main.later && main.later.length > 0)
		sentence = t(`storage-mgr.new.add.many.${kind}`, {from, list: list([main.after ?? 0, ...main.later])})
	else sentence = t('storage-mgr.new.add.one', {from, to: formatSize(main.after ?? 0)})

	// A new drive that fails its own health check is a warning, not an offer
	const failing = main.lastResort || main.blocked?.why === 'failing'
	return (
		<section
			className={cn(
				'@container flex flex-col gap-3 rounded-17 border p-4',
				failing ? 'border-[#F5A623]/30 bg-[#F5A623]/[0.07]' : 'border-[#2DD4BF]/30 bg-[#2DD4BF]/[0.06]',
			)}
		>
			<div className='flex min-w-0 items-center gap-3.5'>
				<span className='flex w-[60px] shrink-0 justify-center'>
					<DriveArt drive={drives[0]} tone={failing ? 'warning' : 'new'} />
				</span>
				<div className='flex min-w-0 flex-col gap-0.5'>
					<h2 className='text-15 font-semibold text-white'>
						{drives.length === 1
							? t('storage-mgr.new.title.one', {drive: driveOfSize(t, drives[0])})
							: t(`storage-mgr.new.title.${kind}`, {count: drives.length})}
					</h2>
					<p className='text-13 leading-snug text-white/60'>{sentence}</p>
				</div>
			</div>
			{/* The buttons sit under the words when the card is wide enough to spare the indent */}
			{usable.length > 0 && (
				<div className='flex flex-wrap gap-2 @[340px]:pl-[74px]'>
					{usable.slice(0, 2).map((offer, index) => (
						<ActionButton
							key={offer.id}
							variant='default'
							className={cn(index === 0 && 'bg-[#1CBFAB] text-white hover:bg-[#1CBFAB]/90 focus-visible:bg-[#1CBFAB]')}
							onClick={() => open(offer.id === 'failsafe' ? {type: 'failsafe'} : {type: 'new', kind, offer: offer.id})}
						>
							{offerLabel(t, offer)}
						</ActionButton>
					))}
				</div>
			)}
		</section>
	)
}

// ---------------------------------------------------------------------------
// Drives
// ---------------------------------------------------------------------------

type OtherDrive = {drive: Drive; tone: DriveTone; detail: string}
type T = ReturnType<typeof useTranslation>['t']

// Every drive in the machine, as the picture should show it
function buildViews(
	state: StorageState,
	view: PoolView,
	t: T,
): {storage: DriveView[]; accel: DriveView[]; others: OtherDrive[]; pairs: [string, string][]} {
	const {members, kind} = state.pool
	const op = state.op
	const switching = op?.kind === 'failsafe' ? op : null
	const step = switching ? failsafeStep(switching) : null

	const forMember = (member: Member, inStorage: boolean): DriveView | null => {
		const drive = view.driveOf(member.id)
		if (!drive) return null
		const trouble = member.state === 'online' ? troubleOf(drive) : null
		const working = member.state === 'rebuilding' || member.state === 'joining'
		const unusable = inStorage && member.state === 'online' ? (view.capacity.shares[member.id]?.unused ?? 0) : 0
		// A switch to one- or two-drive protection copies to the new drives, restarts, then adds
		// the original drive. A switch to mirrored pairs copies each drive to its new pair.
		const target = inStorage && isSwitchTarget(state, member.id)
		return {
			id: member.id,
			drive,
			tone:
				member.state === 'failed' || member.state === 'unusable'
					? 'failed'
					: member.state === 'missing'
						? 'missing'
						: trouble
							? 'warning'
							: 'in',
			note: target
				? t(step?.step === 2 ? 'storage-mgr.drive.adding' : 'storage-mgr.drive.copying')
				: member.state === 'failed'
					? t('storage-ui.state.failed')
					: member.state === 'missing'
						? t('storage-mgr.drive.missing')
						: member.state === 'unusable'
							? t('storage-mgr.drive.unusable')
							: member.state === 'rebuilding'
								? t('storage-mgr.drive.rebuilding')
								: member.state === 'joining'
									? t('storage-mgr.drive.adding')
									: trouble
										? troubleNote(t, trouble)
										: unusable > 0
											? t('storage-setup.unusable', {size: formatSize(unusable)})
											: undefined,
			unusable: unusable || undefined,
			split:
				!target && !trouble && member.state === 'online' && unusable > 0 && unusable < drive.size
					? {usable: drive.size - unusable, unusable}
					: undefined,
			progress: target
				? step?.progress
				: working && op && 'memberId' in op && op.memberId === member.id
					? op.progress
					: undefined,
		}
	}
	const present = (entry: DriveView | null): entry is DriveView => !!entry
	const storage = members.map((member) => forMember(member, true)).filter(present)
	const accel = state.pool.accel.map((member) => forMember(member, false)).filter(present)
	const others: OtherDrive[] = []
	// Drives a switch to FailSafe is bringing in are spoken for: no longer new, not yet members
	for (const drive of view.incoming) {
		const target = isSwitchTarget(state, drive.id)
		const entry: DriveView = {
			id: drive.id,
			drive,
			tone: 'in',
			note: target ? t('storage-mgr.drive.copying') : undefined,
			progress: target ? step?.progress : undefined,
		}
		if (drive.kind !== kind) accel.push(entry)
		else storage.push(entry)
	}
	// A working drive that is being replaced stays where it was until the new one holds everything
	if (view.leaving) {
		storage.push({id: view.leaving.id, drive: view.leaving, tone: 'out', note: t('storage-mgr.drive.leaving')})
	}
	const pairs: [string, string][] =
		state.pool.layout === 'mirror' ? view.capacity.pairs : (state.pool.partialPairs ?? [])
	// New drives of the storage's own kind stand beside it. Anything else is listed beneath:
	// it can't join, and its card says what it can do instead.
	for (const drive of view.loose) {
		// What is wrong with a new drive is said before anything is built on it
		const trouble = troubleOf(drive)
		if (drive.kind === kind) {
			storage.push({
				id: drive.id,
				drive,
				tone: trouble ? 'warning' : 'new',
				note: trouble ? troubleNote(t, trouble) : t('storage-mgr.drive.new'),
			})
		} else {
			others.push({
				drive,
				tone: trouble ? 'warning' : 'new',
				detail: trouble ? troubleNote(t, trouble) : t('storage-mgr.others.new'),
			})
		}
	}
	if (view.system) others.push({drive: view.system, tone: 'out', detail: t('storage-setup.idle.system')})
	return {storage, accel, others, pairs}
}

// What the picture can't say by itself
function DriveNotes({state, view}: {state: StorageState; view: PoolView}) {
	const {t} = useStorageTranslation()
	const {layout, kind} = state.pool
	const {capacity} = view
	const smallest = view.memberDrives.length ? Math.min(...view.memberDrives.map((drive) => drive.size)) : 0
	const mismatch = capacity.unused > 0 && layout !== 'mirror' && layout !== 'stripe' && !state.pool.partialPairs
	const pairs = capacity.unused > 0 && layout === 'mirror'
	// umbreld keeps no record of when a drive was added, so this is only said while it was seen.
	// Only one- and two-drive protection spread data across a new drive: a drive added to Full
	// Storage or a new pair is simply more room.
	const grew = state.finished?.kind === 'expand' && (layout === 'raidz1' || layout === 'raidz2')
	if (!mismatch && !pairs && !grew) return null
	return (
		<div className='flex max-w-[360px] flex-col gap-2 text-center text-12 leading-snug text-white/45'>
			{mismatch && <p>{t(`storage-mgr.note.mismatch.${kind}`, {size: formatSize(smallest)})}</p>}
			{pairs && <p>{t('storage-mgr.note.pairs')}</p>}
			{grew && <p>{t('storage-mgr.note.grew')}</p>}
		</div>
	)
}

// What can be changed, and what is worth knowing. A row says what is true right now: with a
// drive down, FailSafe "needs repair", it does not repeat its promise.
function Settings({state, view, open}: {state: StorageState; view: PoolView; open: (sheet: Sheet) => void}) {
	const {t} = useStorageTranslation()
	const {accel, layout, kind} = state.pool
	const check = state.op?.kind === 'check' ? state.op : null
	const amber = 'font-medium text-[#F5A623]'
	const red = 'font-medium text-[#FF6B6B]'
	// With the storage offline there is nothing here to change, only to read
	if (view.status === 'offline') {
		return (
			<Rows>
				<Row label={t('storage-ui.technical-details')} onClick={() => open({type: 'details'})} />
			</Rows>
		)
	}
	const repair = view.status === 'at-risk' || view.status === 'reduced'
	return (
		<Rows>
			<Row
				label={t('storage-ui.failsafe')}
				value={
					state.pool.partialPairs || (accelExposed(state) && state.op?.kind !== 'failsafe') ? (
						<span className={red}>{t('storage-mgr.row.partly')}</span>
					) : state.op?.kind === 'failsafe' ? (
						t('storage-mgr.row.turning-on')
					) : layout === 'stripe' ? (
						t('storage-setup.off')
					) : state.op?.kind === 'rebuild' ? (
						t('storage-mgr.drive.rebuilding')
					) : repair ? (
						<span className={view.status === 'at-risk' ? red : amber}>{t('storage-mgr.row.needs-repair')}</span>
					) : (
						// What it promises counts the acceleration SSDs in, as the status does
						promise(t, layout, kind, accel.length)
					)
				}
				onClick={() => open({type: 'failsafe'})}
			/>
			{kind === 'hdd' && (
				<Row
					label={t('storage-ui.acceleration')}
					value={
						accel.length === 0 ? (
							t('storage-setup.off')
						) : view.accelDown.length > 0 ? (
							<span className={red}>{t('storage-mgr.row.needs-repair')}</span>
						) : accelExposed(state) && state.op?.kind !== 'failsafe' ? (
							<span className={red}>{t('storage-mgr.row.not-protected')}</span>
						) : (
							t('storage-setup.on')
						)
					}
					onClick={() => open({type: 'acceleration'})}
				/>
			)}
			<Row
				label={t('storage-mgr.check')}
				value={
					check ? (
						<span className='tabular-nums'>
							{t('storage-mgr.row.checking', {progress: Math.floor(check.progress)})}
						</span>
					) : state.pool.dataErrors > 0 ? (
						<span className={red}>{t('storage-mgr.row.found-errors')}</span>
					) : (
						t('storage-mgr.row.every-30-days')
					)
				}
				onClick={() => open({type: 'check'})}
			/>
			<Row label={t('storage-ui.technical-details')} onClick={() => open({type: 'details'})} />
		</Rows>
	)
}
