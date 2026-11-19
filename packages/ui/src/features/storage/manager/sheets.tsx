// Storage Manager's sheets: everything that opens from the status, a drive, a new drive's
// card or a row. A sheet that asks umbreld for something shows that it is starting, and if
// umbreld refuses, stays open with one plain sentence and a way to try again.

import {useEffect, useRef, useState} from 'react'
import {TbArrowDown, TbCheck} from 'react-icons/tb'

import {Button} from '@/components/ui/button'
import {cn} from '@/lib/utils'

import {DriveTone, LevelGlyph} from '../art'
import {DriveFacts, TemperatureAdvice} from '../drive-facts'
import {
	Drive,
	FailsafeLayout,
	formatSize,
	isFailing,
	layoutTech,
	MAX_HDD_RAIDZ1_DRIVES,
	parityOf,
	troubleOf,
} from '../model'
import {
	DriveBanner,
	DriveLine,
	Note,
	OptionCard,
	OptionGroup,
	ProgressBar,
	RequestingProvider,
	Row,
	Rows,
	RunError,
	SectionLabel,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	sheetListClass,
	SheetRoot,
	SheetTitle,
	Steps,
	TechTag,
	useRun,
} from '../parts'
import {blockedSentence, driveTitle, promise, promiseSentence, taskSentence, troubleNote} from '../phrases'
import {
	accelExposed,
	busyWith,
	failsafeAction,
	failsafeBlocked,
	FailsafeOption,
	failsafeStep,
	getFailsafePlan,
	getOffers,
	getSwapPlan,
	isBroken,
	isSwitchTarget,
	neededSize,
	Offer,
	offerAction,
	peerDrives,
	PoolView,
	StepsVariant,
	taskProgress,
} from '../state'
import {forKind, useStorageTranslation} from '../words'
import {offerLabel, StorageManagerProps, Timeline} from './shared'
import {driveActionLabel, Sheet, sheetForSwap, sheetStands} from './status'

type SheetProps = StorageManagerProps & {view: PoolView; setSheet: (sheet: Sheet) => void}

export function Sheets({sheet, ...live}: SheetProps & {sheet: Sheet}) {
	const {setSheet} = live
	// A sheet's own request changes the storage the moment it is sent: the island shows it
	// starting before umbreld has answered. Until it has, the sheet goes on showing what was
	// confirmed, so that nothing shifts under the button and a refusal has somewhere to be said.
	const [requesting, setRequesting] = useState(false)
	const confirmed = useRef<Pick<SheetProps, 'state' | 'view'> | null>(null)
	const report = (isRequesting: boolean) => {
		confirmed.current = isRequesting ? {state: live.state, view: live.view} : null
		setRequesting(isRequesting)
	}
	const props = requesting && confirmed.current ? {...live, ...confirmed.current} : live
	// Otherwise a sheet closes when the storage changes under it, so nothing is confirmed unread
	const stands = requesting || sheetStands(live.state, live.view, sheet)
	useEffect(() => {
		if (!stands) setSheet(null)
	}, [stands, setSheet])
	// A sheet that is closed has no request left to wait for
	useEffect(() => {
		if (sheet === null) setRequesting(false)
	}, [sheet])
	return (
		<SheetRoot open={sheet !== null && stands} onOpenChange={(isOpen) => !isOpen && setSheet(null)}>
			{sheet && stands && (
				<SheetContent>
					<RequestingProvider value={report}>
						{sheet.type === 'drive' && <DriveSheet {...props} id={sheet.id} />}
						{sheet.type === 'replace' && <ReplaceSheet {...props} memberId={sheet.memberId} newId={sheet.newId} />}
						{sheet.type === 'repair' && <RepairSheet {...props} memberId={sheet.memberId} />}
						{sheet.type === 'steps' && (
							<StepsSheet {...props} memberId={sheet.memberId} variant={sheet.variant} risky={sheet.risky} />
						)}
						{sheet.type === 'blocked' && <BlockedSheet {...props} memberId={sheet.memberId} />}
						{sheet.type === 'new' && <NewDrivesSheet {...props} kind={sheet.kind} only={sheet.offer} />}
						{sheet.type === 'failsafe' && <FailsafeSheet {...props} />}
						{sheet.type === 'acceleration' && <AccelerationSheet {...props} />}
						{sheet.type === 'check' && <CheckSheet {...props} />}
						{sheet.type === 'details' && <DetailsSheet {...props} />}
						{sheet.type === 'install' && <InstallSheet {...props} />}
						{sheet.type === 'offline' && <OfflineSheet {...props} />}
					</RequestingProvider>
				</SheetContent>
			)}
		</SheetRoot>
	)
}

function Done({setSheet, label}: {setSheet: (sheet: Sheet) => void; label?: string}) {
	const {t} = useStorageTranslation()
	return (
		<Button size='dialog' onClick={() => setSheet(null)}>
			{label ?? t('done')}
		</Button>
	)
}

// A FailSafe Mode as the row for it shows it: its drives drawn, then its technical name
function ModeMark({layout, count}: {layout: FailsafeLayout; count: number}) {
	return (
		<span className='flex shrink-0 items-center gap-2.5'>
			<LevelGlyph layout={layout} count={count} />
			<TechTag>{layoutTech[layout]}</TechTag>
		</span>
	)
}

// The one line every confirm carries, instead of a red button
function ErasedLine({count}: {count: number}) {
	const {t} = useStorageTranslation()
	return <p className='px-1 text-12 leading-snug text-white/45'>{t('storage-mgr.erased', {count})}</p>
}

// The Umbrel Pro installation photo: it does the teaching, the steps fill in the rest
function ProInstallPhoto() {
	const {t} = useStorageTranslation()
	const mask =
		'linear-gradient(to right, transparent 0%, black 15%), linear-gradient(to bottom, black 85%, transparent 100%)'
	return (
		<img
			src='/assets/storage/install-ssd-instruction.webp'
			alt={t('storage-manager.install-ssd.image-alt')}
			className='w-full rounded-8'
			draggable={false}
			style={{
				aspectRatio: '1646 / 1186',
				maskImage: mask,
				maskComposite: 'intersect',
				WebkitMaskImage: mask,
				WebkitMaskComposite: 'source-in',
			}}
		/>
	)
}

function BeforeAfter({before, after}: {before: number; after: number}) {
	const {t} = useStorageTranslation()
	return (
		<div className='flex items-center justify-center gap-4 rounded-12 bg-white/5 py-4'>
			<span className='flex flex-col items-center'>
				<span className='text-[22px] leading-none font-semibold text-white/50'>{formatSize(before)}</span>
				<span className='mt-1 text-11 text-white/40'>{t('storage-mgr.now')}</span>
			</span>
			<span className='text-white/30' aria-hidden>
				→
			</span>
			<span className='flex flex-col items-center'>
				<span className='text-[22px] leading-none font-semibold text-white'>{formatSize(after)}</span>
				<span className='mt-1 text-11 text-white/40'>{t('storage-mgr.after')}</span>
			</span>
		</div>
	)
}

// Every drive a confirm erases, each with what tells it apart
function ErasedDrives({drives, noteOf}: {drives: Drive[]; noteOf?: (drive: Drive) => string | undefined}) {
	if (drives.length === 0) return null
	return (
		<div className={cn('flex flex-col divide-y divide-white/[0.06] rounded-12 bg-white/5', sheetListClass)}>
			{drives.map((drive) => {
				const note = noteOf?.(drive)
				return (
					// A row keeps its height and the list scrolls. What tells the drive apart sits beside
					// it where the sheet is wide enough, and under it on a phone.
					<DriveLine
						key={drive.id}
						drive={drive}
						slot={drive.slot}
						tone='new'
						className='@container min-h-[52px] shrink-0'
						below={note && <span className='@[360px]:hidden'>{note}</span>}
						trailing={
							note && (
								<span className='hidden shrink-0 text-right text-12 leading-snug text-white/50 @[360px]:block'>
									{note}
								</span>
							)
						}
					/>
				)
			})}
		</div>
	)
}

// ---------------------------------------------------------------------------
// One drive
// ---------------------------------------------------------------------------

function DriveSheet({state, view, id, setSheet, temperatureUnit}: SheetProps & {id: string}) {
	const {t, i18n} = useStorageTranslation()
	const drive = view.driveOf(id)
	if (!drive) return null
	const memberState = view.stateOf(id)
	const isAccel = state.pool.accel.some((member) => member.id === id)
	const incoming = view.incoming.some((other) => other.id === id)
	const leaving = view.leaving?.id === id
	const isNew = !memberState && !drive.system && !incoming && !leaving
	const trouble = memberState === 'online' || !memberState ? troubleOf(drive) : null
	const paired = state.pool.partialPairs?.some((pair) => pair.includes(id))
	const switching = state.op?.kind === 'failsafe' ? state.op : null
	// The switch is writing to this drive, or the drive is waiting to join when it is done
	const beingAdded = isSwitchTarget(state, id) || (incoming && !!switching?.newIds)

	const use = drive.system
		? t('storage-mgr.use.system')
		: leaving
			? t('storage-mgr.drive.leaving')
			: beingAdded
				? t('storage-mgr.use.adding')
				: incoming
					? // A switch this session didn't start: which drives it took isn't known until it finishes
						t('storage-mgr.use.switching')
					: isNew
						? t('storage-ui.use.none')
						: isAccel || id === switching?.accelId
							? t('storage-ui.acceleration')
							: state.pool.partialPairs
								? t(paired ? 'storage-mgr.use.paired' : 'storage-mgr.use.unpaired')
								: state.pool.layout === 'stripe'
									? t('storage-ui.use.storage')
									: t('storage-ui.use.failsafe')
	const broken = memberState === 'failed' || memberState === 'missing' || memberState === 'unusable'
	const status = beingAdded
		? t('storage-mgr.state.adding')
		: memberState === 'failed'
			? t('storage-ui.state.failed')
			: memberState === 'missing'
				? t('storage-mgr.drive.missing')
				: memberState === 'unusable'
					? t('storage-mgr.state.unusable')
					: memberState === 'rebuilding'
						? t('storage-mgr.drive.rebuilding')
						: memberState === 'joining'
							? t('storage-mgr.state.adding')
							: trouble
								? t(`storage-mgr.state.${trouble}`)
								: undefined
	const tone: DriveTone = isNew
		? 'new'
		: memberState === 'missing'
			? 'missing'
			: broken
				? 'failed'
				: trouble
					? 'warning'
					: drive.system || leaving
						? 'out'
						: 'in'
	const offers = isNew ? getOffers(state, drive.kind) : []
	const main = offers.find((offer) => !offer.blocked && offer.id !== 'replace')
	const plan = memberState ? getSwapPlan(state, id) : null
	const canSwap =
		plan && memberState !== 'rebuilding' && memberState !== 'joining' && view.status !== 'offline' && !beingAdded

	return (
		<>
			<SheetHeader>
				<SheetTitle>{driveTitle(t, drive)}</SheetTitle>
			</SheetHeader>
			<DriveBanner drive={drive} tone={tone} note={trouble ? troubleNote(t, trouble) : undefined} />
			<DriveFacts
				drive={drive}
				use={use}
				status={status}
				statusTone={broken || trouble === 'critical' ? 'critical' : trouble ? 'attention' : 'good'}
				unit={temperatureUnit}
			/>
			{leaving && <Note>{t('storage-mgr.replace.keep-both')}</Note>}
			{memberState === 'unusable' && <Note>{t('storage-mgr.drive.unusable.note')}</Note>}
			{memberState === 'missing' && <Note>{t('storage-mgr.drive.missing.note')}</Note>}
			{trouble === 'errors' && <Note>{t('storage-mgr.status.trouble.errors.body')}</Note>}
			<TemperatureAdvice drive={drive} isPro={state.device === 'pro'} />
			{drive.system && <Note>{t('storage-setup.system-drive')}</Note>}
			{isNew && offers.length > 0 && offers.every((offer) => offer.blocked) && (
				<Note>{blockedSentence(t, offers[0].blocked!, drive.kind, i18n.language)}</Note>
			)}
			<SheetFooter>
				{main && (
					<Button
						variant='primary'
						size='dialog'
						onClick={() =>
							setSheet(main.id === 'failsafe' ? {type: 'failsafe'} : {type: 'new', kind: drive.kind, offer: main.id})
						}
					>
						{offerLabel(t, main)}
					</Button>
				)}
				{canSwap && (
					<Button
						variant={broken ? 'primary' : 'default'}
						size='dialog'
						onClick={() => setSheet(sheetForSwap(state, id))}
					>
						{driveActionLabel(t, plan.kind === 'repair' ? 'repair' : broken ? 'replace' : 'swap', drive)}
					</Button>
				)}
				<Done setSheet={setSheet} />
			</SheetFooter>
		</>
	)
}

const timeKey = (drive: Pick<Drive, 'kind'>) => `storage-mgr.time.${drive.kind}`

// The drive that goes and the drive that takes its place, each with its serial: on other
// hardware that is the only way to tell which of four identical drives is meant
function ReplaceSheet({state, view, memberId, newId, setSheet, run}: SheetProps & {memberId: string; newId: string}) {
	const {t} = useStorageTranslation()
	const request = useRun()
	const old = view.driveOf(memberId)
	const fresh = view.driveOf(newId)
	if (!fresh || !old) return null
	const memberState = view.stateOf(memberId)
	const healthy = memberState === 'online'
	const plan = getSwapPlan(state, memberId)
	const keepsOld = plan.kind === 'replace' && plan.keepsOld
	// Drives that protect each other are each used up to the size of the smallest
	const used = Math.min(fresh.size, ...peerDrives(state, view, memberId).map((drive) => drive.size))
	const extra = state.pool.layout === 'stripe' ? 0 : fresh.size - used
	const busy = state.op && state.op.kind !== 'check' ? busyWith(state) : undefined
	const verb = healthy ? 'swap' : 'replace'
	const trouble = troubleOf(old)
	return (
		<>
			<SheetHeader>
				<SheetTitle>
					{old.slot
						? t(`storage-mgr.${verb}.title.slot`, {slot: old.slot})
						: t(`storage-mgr.${verb}.title.${old.kind}`)}
				</SheetTitle>
				<SheetDescription>
					{t(healthy && state.pool.layout === 'stripe' ? 'storage-mgr.replace.moves' : 'storage-mgr.replace.rebuilds')}{' '}
					{t(timeKey(fresh))} {t('storage-mgr.keep-using')}
				</SheetDescription>
			</SheetHeader>
			<div className='flex flex-col items-center gap-1.5'>
				<div className='w-full'>
					<DriveBanner
						drive={old}
						slot={old.slot}
						tone={memberState === 'missing' ? 'missing' : healthy ? (trouble ? 'warning' : 'in') : 'failed'}
						note={
							memberState === 'missing'
								? t('storage-mgr.drive.missing')
								: memberState === 'unusable'
									? t('storage-mgr.drive.unusable')
									: healthy
										? trouble
											? troubleNote(t, trouble)
											: undefined
										: t('storage-ui.state.failed')
						}
					/>
				</div>
				<TbArrowDown className='size-4 text-white/35' aria-hidden />
				<div className='w-full'>
					<DriveBanner
						drive={fresh}
						slot={fresh.slot}
						tone={isFailing(fresh) ? 'warning' : 'new'}
						note={isFailing(fresh) ? troubleNote(t, 'failing') : t('storage-mgr.drive.new')}
					/>
				</div>
			</div>
			{isFailing(fresh) && <Note tone='warning'>{t(`storage-mgr.replace.last-resort.${fresh.kind}`)}</Note>}
			{keepsOld && <Note>{t('storage-mgr.replace.keep-both')}</Note>}
			{extra > 0 && (
				<Note>
					{t(state.pool.layout === 'mirror' ? 'storage-mgr.replace.bigger.pair' : 'storage-mgr.replace.bigger', {
						extra: formatSize(extra),
						size: formatSize(fresh.size),
					})}
				</Note>
			)}
			{state.op?.kind === 'check' && <Note>{t('storage-mgr.check.stops')}</Note>}
			{busy && (
				<Note tone='warning'>{t('storage-ui.blocked.busy', {task: taskSentence(t, busy.task, busy.progress)})}</Note>
			)}
			<RunError message={t('storage-mgr.failed.replace')} error={request.error} />
			<ErasedLine count={1} />
			<SheetFooter>
				<Button
					variant='primary'
					size='dialog'
					disabled={!!busy || request.pending}
					onClick={async () => {
						if (await request.run(() => run({type: 'replace', memberId, newId}))) setSheet(null)
					}}
				>
					{request.pending ? t('storage-ui.starting') : request.error ? t('try-again') : driveActionLabel(t, verb, old)}
				</Button>
				<Done setSheet={setSheet} label={t('cancel')} />
			</SheetFooter>
		</>
	)
}

// Repair erases a drive that was part of the storage, so its button stays red
function RepairSheet({state, view, memberId, setSheet, run}: SheetProps & {memberId: string}) {
	const {t} = useStorageTranslation()
	const request = useRun()
	const drive = view.driveOf(memberId)
	if (!drive) return null
	return (
		<>
			<SheetHeader>
				<SheetTitle>
					{drive.slot
						? t('storage-mgr.repair.title.slot', {slot: drive.slot})
						: t(`storage-mgr.repair.title.${drive.kind}`)}
				</SheetTitle>
				<SheetDescription>
					{t('storage-mgr.repair.body')} {t(timeKey(drive))} {t('storage-mgr.keep-using')}
				</SheetDescription>
			</SheetHeader>
			<DriveBanner drive={drive} slot={drive.slot} tone='failed' note={t('storage-mgr.drive.unusable')} />
			{state.op?.kind === 'check' && <Note>{t('storage-mgr.check.stops')}</Note>}
			<RunError message={t('storage-mgr.failed.repair')} error={request.error} />
			<SheetFooter>
				<Button
					variant='destructive'
					size='dialog'
					disabled={request.pending}
					onClick={async () => {
						if (await request.run(() => run({type: 'repair', memberId}))) setSheet(null)
					}}
				>
					{request.pending
						? t('storage-ui.starting')
						: request.error
							? t('try-again')
							: t('storage-mgr.repair.confirm')}
				</Button>
				<Done setSheet={setSheet} label={t('cancel')} />
			</SheetFooter>
		</>
	)
}

function StepsSheet({
	state,
	view,
	memberId,
	variant,
	risky,
	setSheet,
	onShutdown,
	onOpenBackups,
}: SheetProps & {memberId: string; variant: StepsVariant; risky?: boolean}) {
	const {t} = useStorageTranslation()
	const old = view.driveOf(memberId)
	if (!old) return null
	const isPro = state.device === 'pro'
	// As large as the smallest drive it will work with. 0 when the storage can't say.
	const needed = neededSize(state, view, memberId)
	const memberState = view.stateOf(memberId)
	const healthy = memberState === 'online'
	const protectedHere = state.pool.layout !== 'stripe'
	const where = isPro ? 'pro' : old.kind
	const params = {size: formatSize(needed), slot: old.slot, serial: old.serial}

	const description = risky
		? t('storage-mgr.steps.risky.intro')
		: variant === 'reset'
			? t('storage-mgr.steps.reset.intro')
			: variant === 'insert'
				? t(`storage-mgr.steps.insert.intro.${old.kind}`)
				: variant === 'either'
					? t('storage-mgr.steps.either.intro')
					: variant === 'beside'
						? t(protectedHere ? 'storage-mgr.steps.beside.intro.failsafe' : 'storage-mgr.steps.beside.intro.full')
						: t('storage-mgr.steps.in-place.intro')
	const count = variant === 'reset' || isPro || variant === 'either' || variant === 'in-place' ? 3 : 2
	// A step that names a size or a slot has another form for when that isn't known: a drive
	// that is gone may have left no size behind, and not every SSD reports its slot
	const stepKey = (index: number) => {
		const namesTheDrive = index === (isPro ? 2 : 1)
		const unplaced = isPro && index === 2 && (variant === 'beside' || variant === 'in-place') && !old.slot
		const form =
			variant === 'insert' && namesTheDrive
				? needed === 0
					? '.any'
					: isPro && old.slot
						? '.slot'
						: ''
				: unplaced
					? '.serial'
					: ''
		return `storage-mgr.steps.${variant}.${variant === 'reset' ? 'all' : where}.${index}${form}`
	}
	const steps = Array.from({length: count}, (_, index) => t(stepKey(index + 1), params))

	return (
		<>
			<SheetHeader>
				<SheetTitle>
					{old.slot
						? t(`storage-mgr.${healthy ? 'swap' : 'replace'}.steps.slot`, {slot: old.slot})
						: t(`storage-mgr.${healthy ? 'swap' : 'replace'}.steps.${old.kind}`)}
				</SheetTitle>
				<SheetDescription>{description}</SheetDescription>
			</SheetHeader>
			{isPro && variant !== 'reset' && <ProInstallPhoto />}
			<Steps steps={steps} />
			{healthy && variant === 'in-place' && protectedHere && (
				<Note tone='warning'>
					{t(view.spare <= 1 ? 'storage-mgr.steps.unprotected' : 'storage-mgr.steps.less-protected')}{' '}
					{t('storage-mgr.steps.back-up-first')}
				</Note>
			)}
			{healthy && variant !== 'in-place' && variant !== 'reset' && <Note>{t('storage-mgr.steps.back-up-first')}</Note>}
			{/* Every slot is taken, so the drive has to come out even though the others aren't sound */}
			{risky && variant === 'in-place' && <Note tone='warning'>{t('storage-mgr.steps.risky.no-room')}</Note>}
			<SheetFooter>
				{isPro && variant !== 'reset' && (
					<Button variant='primary' size='dialog' onClick={onShutdown}>
						{t('shut-down')}
					</Button>
				)}
				{(variant === 'reset' || risky) && (
					<Button variant={variant === 'reset' ? 'primary' : 'default'} size='dialog' onClick={onOpenBackups}>
						{t('storage-mgr.action.backups')}
					</Button>
				)}
				<Done setSheet={setSheet} />
			</SheetFooter>
		</>
	)
}

function BlockedSheet({state, memberId, setSheet}: SheetProps & {memberId: string}) {
	const {t, i18n} = useStorageTranslation()
	const plan = getSwapPlan(state, memberId)
	if (plan.kind !== 'blocked') return null
	return (
		<>
			<SheetHeader>
				<SheetTitle>{t(`storage-mgr.blocked.${plan.reason}.title`)}</SheetTitle>
				<SheetDescription>
					{plan.blocked
						? blockedSentence(t, plan.blocked, state.pool.kind, i18n.language)
						: t(`storage-mgr.blocked.${plan.reason}.body`)}
				</SheetDescription>
			</SheetHeader>
			<SheetFooter>
				<Done setSheet={setSheet} />
			</SheetFooter>
		</>
	)
}

// ---------------------------------------------------------------------------
// New drives
// ---------------------------------------------------------------------------

function NewDrivesSheet({
	state,
	view,
	kind,
	only,
	setSheet,
	run,
}: SheetProps & {kind: Drive['kind']; only?: Offer['id']}) {
	const {t: storageT, i18n} = useStorageTranslation()
	// New SSDs are spoken of as SSDs, also where they join hard drives to accelerate them
	const t = forKind(storageT, kind)
	const request = useRun()
	const every = getOffers(state, kind).filter((offer) => offer.id !== 'failsafe')
	const offers = only ? every.filter((offer) => offer.id === only) : every
	const [chosenId, setChosenId] = useState(() => (offers.find((offer) => offer.primary) ?? offers[0])?.id)
	const found = offers.find((candidate) => candidate.id === chosenId)
	// The drive a replacement was opened for. Should another drive become the one to replace
	// while this is open, the sheet closes: it never moves on to a drive nobody chose.
	const [targetId] = useState(found?.memberId)
	const offer = found && found.memberId === targetId ? found : undefined
	// More new drives than it takes: which ones is the person's choice
	const [pickedIds, setPickedIds] = useState<string[] | null>(null)
	const gone = !offer
	useEffect(() => {
		if (gone) setSheet(null)
	}, [gone, setSheet])
	if (!offer) return null
	const picked = pickedIds
		? offer.choices.filter((drive) => pickedIds.includes(drive.id))
		: offer.choices.filter((drive) => offer.drives.includes(drive))
	const {blocked} = offer
	const canChoose = offer.choices.length > offer.takes
	const toggle = (id: string) => {
		const current = picked.map((drive) => drive.id)
		let next = current.includes(id) ? current.filter((other) => other !== id) : [...current, id]
		if (next.length > offer.takes) next = next.slice(next.length - offer.takes)
		setPickedIds(next)
	}
	const action = offerAction(state, offer, picked)
	const before = view.capacity.usable
	// What it comes to with the drives that are picked
	const after =
		picked.length < offer.takes
			? undefined
			: offer.id === 'pair'
				? before + Math.min(...picked.map((drive) => drive.size)) * view.scale
				: offer.id === 'add' && state.pool.layout === 'stripe'
					? before + picked[0].size * view.scale
					: offer.after
	const smallest = view.memberDrives.length ? Math.min(...view.memberDrives.map((drive) => drive.size)) : 0
	const unused =
		offer.id === 'add' && state.pool.layout !== 'stripe' && picked[0] ? picked[0].size - smallest : (offer.unused ?? 0)

	return (
		<>
			<SheetHeader>
				<SheetTitle>{offerLabel(t, offer)}</SheetTitle>
				<SheetDescription>{t(`storage-mgr.new.sheet.${offer.id}${offer.closes ? '.closes' : ''}`)}</SheetDescription>
			</SheetHeader>

			{offers.length > 1 && (
				<OptionGroup label={t('storage-mgr.new.sheet.choose')}>
					{offers.map((candidate) => (
						<OptionCard
							key={candidate.id}
							selected={candidate.id === offer.id}
							onSelect={() => {
								setChosenId(candidate.id)
								setPickedIds(null)
							}}
							title={offerLabel(t, candidate)}
							description={candidate.blocked ? blockedSentence(t, candidate.blocked, kind, i18n.language) : undefined}
							disabledReason={candidate.blocked ? t('storage-mgr.not-yet') : undefined}
						/>
					))}
				</OptionGroup>
			)}

			{blocked ? (
				<Note>{blockedSentence(t, blocked, kind, i18n.language)}</Note>
			) : (
				<>
					{after !== undefined && offer.id !== 'accelerate' && <BeforeAfter before={before} after={after} />}
					{canChoose ? (
						<div className='flex flex-col gap-1.5'>
							<SectionLabel className='px-1 text-12'>
								{t(`storage-mgr.new.sheet.pick.${kind}`, {count: offer.takes})}
							</SectionLabel>
							<div className='flex max-h-[220px] flex-col divide-y divide-white/[0.06] overflow-y-auto rounded-12 bg-white/5'>
								{offer.choices.map((drive) => {
									const on = picked.some((other) => other.id === drive.id)
									return (
										<button
											key={drive.id}
											type='button'
											role='checkbox'
											aria-checked={on}
											onClick={() => toggle(drive.id)}
											className='text-left outline-hidden transition-colors hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-inset'
										>
											<DriveLine
												drive={drive}
												slot={drive.slot}
												tone={on ? 'new' : 'out'}
												className='min-h-[52px]'
												trailing={
													<span
														className={cn(
															'flex size-[22px] shrink-0 items-center justify-center rounded-full border transition-colors',
															on ? 'border-white bg-white' : 'border-white/30',
														)}
													>
														{on && <TbCheck className='size-3.5 text-black' strokeWidth={3.5} />}
													</span>
												}
											/>
										</button>
									)
								})}
							</div>
						</div>
					) : (
						<ErasedDrives drives={picked} />
					)}
					{canChoose && offer.id === 'add' && state.pool.layout !== 'stripe' && (
						<Note>{t('storage-mgr.new.sheet.one-at-a-time')}</Note>
					)}
					{unused > 0 && (
						<Note>{t('storage-mgr.new.sheet.unused', {size: formatSize(smallest), unused: formatSize(unused)})}</Note>
					)}
					{offer.id === 'add' && state.pool.layout !== 'stripe' && (
						<Note>
							{t(timeKey({kind}))} {t('storage-mgr.keep-using')}
						</Note>
					)}
					{offer.lastResort && <Note tone='warning'>{t(`storage-mgr.replace.last-resort.${kind}`)}</Note>}
					{/* What can't be undone gets the weight of a warning, where the choice is made */}
					{offer.closes && <Note tone='warning'>{t(`storage-mgr.new.sheet.closes.${offer.closes}`)}</Note>}
					{offer.id === 'accelerate' && (
						<Note>
							{t(offer.takes === 2 ? 'storage-setup.accel.permanent-two' : 'storage-setup.accel.permanent-one')}{' '}
							{t(offer.takes === 2 ? 'storage-setup.accel.mirrored' : 'storage-setup.accel.single')}
						</Note>
					)}
					<RunError message={t('storage-mgr.failed.start')} error={request.error} />
					<ErasedLine count={offer.takes} />
				</>
			)}

			<SheetFooter>
				{!blocked && (
					<Button
						variant={offer.closes ? 'destructive' : 'primary'}
						size='dialog'
						disabled={!action || request.pending}
						onClick={async () => {
							if (action && (await request.run(() => run(action)))) setSheet(null)
						}}
					>
						{request.pending ? t('storage-ui.starting') : request.error ? t('try-again') : offerLabel(t, offer)}
					</Button>
				)}
				<Done setSheet={setSheet} label={blocked ? undefined : t('cancel')} />
			</SheetFooter>
		</>
	)
}

// ---------------------------------------------------------------------------
// FailSafe
// ---------------------------------------------------------------------------

function FailsafeSheet(props: SheetProps) {
	const {state, view, setSheet, run, onOpenBackups, supportUrl} = props
	const {t, i18n} = useStorageTranslation()
	const request = useRun()
	const plan = getFailsafePlan(state)
	const {kind, layout, members, accel} = state.pool
	const [to, setTo] = useState(() => plan.options.find((option) => !failsafeBlocked(state, plan, option))?.to)
	const chosen = plan.options.find((option) => option.to === to)

	// A switch is under way: what was chosen, where it has got to, and what happens next
	if (state.op?.kind === 'failsafe') {
		const {step, progress} = failsafeStep(state.op)
		const target = state.op.to
		return (
			<>
				<SheetHeader>
					<SheetTitle>{t('storage-mgr.status.switch.title')}</SheetTitle>
					<SheetDescription>
						{target
							? promiseSentence(t, target, kind, state.op.accelId ? 2 : accel.length)
							: t('storage-mgr.failsafe.running.generic')}
					</SheetDescription>
				</SheetHeader>
				{target && (
					<Rows>
						<Row
							label={t('storage-setup.protection')}
							trailing={
								<ModeMark layout={target} count={target === 'mirror' ? members.length : parityOf(target) + 1} />
							}
						/>
					</Rows>
				)}
				{step === null ? (
					<ProgressBar value={progress ?? 0} label={t('storage-mgr.status.switch.title')} />
				) : (
					<Timeline current={step} progress={progress} />
				)}
				<Note>
					{step === 0
						? t('storage-mgr.failsafe.running.restart-ahead')
						: step === 1
							? t('storage-mgr.status.switch.restarting')
							: step === 2
								? t('storage-mgr.status.switch.adding')
								: t('storage-mgr.status.switch.pairs')}{' '}
					{t('storage-mgr.failsafe.running.no-cancel')}
					{step !== 1 && ` ${t('storage-mgr.status.resumes')}`}
				</Note>
				<SheetFooter>
					<Done setSheet={setSheet} />
				</SheetFooter>
			</>
		)
	}

	// FailSafe is on: what it is, in both vocabularies, and what can't be changed about it
	if (layout !== 'stripe' && !accelExposed(state)) {
		const fullPro = state.device === 'pro' && view.freeSlots === 0
		return (
			<>
				<SheetHeader>
					<SheetTitle>{t('storage-ui.failsafe')}</SheetTitle>
					<SheetDescription>
						{promiseSentence(t, layout, kind, accel.length)} {t('storage-mgr.failsafe.on.rebuilds')}
					</SheetDescription>
				</SheetHeader>
				<Rows>
					<Row label={t('storage-setup.protection')} trailing={<ModeMark layout={layout} count={members.length} />} />
					<Row label={t('storage-mgr.failsafe.on.aside')} value={formatSize(view.capacity.protection)} />
					<Row
						label={t('storage-mgr.failsafe.on.grow')}
						value={
							fullPro
								? t('storage-mgr.failsafe.on.grow.swap')
								: layout === 'mirror'
									? t('storage-setup.compare.grow.mirror')
									: layout === 'raidz1' && kind === 'hdd'
										? t('storage-setup.compare.grow.raidz1')
										: t('storage-setup.compare.grow.raidz2')
						}
					/>
				</Rows>
				<Note>{t('storage-mgr.failsafe.on.permanent')}</Note>
				<SheetFooter>
					<Done setSheet={setSheet} />
				</SheetFooter>
			</>
		)
	}

	// umbreld has no way to finish a switch that stopped part way, or to protect several SSDs
	// of Full Storage: both mean starting over
	const exposed = accelExposed(state)
	if (plan.impossible || exposed) {
		const partly = plan.impossible === 'partly-on' || exposed
		return (
			<>
				<SheetHeader>
					<SheetTitle>
						{t(partly ? 'storage-mgr.status.partly.title' : 'storage-mgr.failsafe.impossible.title')}
					</SheetTitle>
					<SheetDescription>
						{t(
							exposed
								? 'storage-mgr.failsafe.partly.accel'
								: partly
									? 'storage-mgr.failsafe.partly.body'
									: 'storage-mgr.failsafe.impossible.body',
						)}
					</SheetDescription>
				</SheetHeader>
				<Steps
					steps={[
						t('storage-mgr.failsafe.restart-over.1'),
						t('storage-mgr.failsafe.restart-over.2'),
						t('storage-mgr.failsafe.restart-over.3'),
					]}
				/>
				{partly && <Note>{t('storage-mgr.failsafe.partly.support')}</Note>}
				<SheetFooter>
					<Button variant='primary' size='dialog' onClick={onOpenBackups}>
						{t('storage-mgr.action.backups')}
					</Button>
					{partly && supportUrl && (
						<Button size='dialog' asChild>
							<a href={supportUrl} target='_blank' rel='noreferrer'>
								{t('storage-ui.contact-support')}
							</a>
						</Button>
					)}
					<Done setSheet={setSheet} />
				</SheetFooter>
			</>
		)
	}

	const blockedOf = (option: FailsafeOption) => failsafeBlocked(state, plan, option)
	const noneReady = plan.options.every((option) => blockedOf(option))
	const action = chosen ? failsafeAction(plan, chosen) : undefined
	const erased = chosen
		? [
				...chosen.needs.map((need) => need.drive).filter((drive): drive is Drive => !!drive),
				...(plan.accel?.drive ? [plan.accel.drive] : []),
			]
		: []
	const describe = (option: FailsafeOption) => {
		const blocked = blockedOf(option)
		if (blocked) return blockedSentence(t, blocked, kind, i18n.language)
		const uses = t(`storage-mgr.failsafe.uses.${kind}`, {count: option.needs.length})
		// A further new drive isn't lost: it can be added once FailSafe is on
		return option.later.length > 0
			? `${uses} ${t('storage-mgr.failsafe.later', {now: formatSize(option.after), later: formatSize(option.later.at(-1)!)})}`
			: uses
	}

	return (
		<>
			<SheetHeader>
				<SheetTitle>{t('storage-mgr.action.turn-on-failsafe')}</SheetTitle>
				<SheetDescription>
					{t(noneReady ? `storage-mgr.failsafe.needs-more.${kind}` : 'storage-mgr.failsafe.keeps-everything')}
				</SheetDescription>
			</SheetHeader>

			<OptionGroup label={t('storage-setup.protection')}>
				{plan.options.map((option) => {
					const blocked = blockedOf(option)
					return (
						<OptionCard
							key={option.to}
							selected={to === option.to}
							onSelect={() => setTo(option.to)}
							icon={<LevelGlyph layout={option.to} count={members.length + option.needs.length} />}
							iconCaption={layoutTech[option.to]}
							title={promise(t, option.to, kind)}
							description={describe(option)}
							value={blocked ? undefined : formatSize(option.after)}
							disabledReason={blocked ? t('storage-mgr.not-yet') : undefined}
						/>
					)
				})}
			</OptionGroup>

			{chosen && action && (
				<>
					<ErasedDrives
						drives={erased}
						// With mirrored pairs, which drive each new one pairs with: its serial is the only way to tell
						noteOf={(drive) => {
							const existing = chosen.needs.find((need) => need.drive?.id === drive.id)?.existingId
							const serial = existing && view.driveOf(existing)?.serial
							return chosen.to === 'mirror' && serial ? t('storage-mgr.failsafe.pairs-with', {serial}) : undefined
						}}
					/>
					<Note>
						{t(chosen.to === 'mirror' ? 'storage-mgr.failsafe.how.pairs' : 'storage-mgr.failsafe.how.restart', {
							count: chosen.needs.length,
						})}{' '}
						{t(timeKey({kind}))} {t('storage-setup.permanent.failsafe')}
						{/* SSDs have one level, so there is no level to speak of */}
						{kind === 'hdd' && ` ${t('storage-setup.permanent.level')}`}
					</Note>
					{plan.accel?.drive && (
						<Note>{t('storage-mgr.failsafe.accel.joins', {size: formatSize(plan.accel.drive.size)})}</Note>
					)}
				</>
			)}
			<RunError message={t('storage-mgr.failed.failsafe')} error={request.error} />
			{action && <ErasedLine count={erased.length} />}

			<SheetFooter>
				{!noneReady && (
					<Button
						variant='primary'
						size='dialog'
						disabled={!action || request.pending}
						onClick={async () => {
							if (action && (await request.run(() => run(action)))) setSheet(null)
						}}
					>
						{request.pending
							? t('storage-ui.starting')
							: request.error
								? t('try-again')
								: t('storage-mgr.action.turn-on-failsafe')}
					</Button>
				)}
				<Done setSheet={setSheet} label={noneReady ? undefined : t('cancel')} />
			</SheetFooter>
		</>
	)
}

// ---------------------------------------------------------------------------
// SSD Acceleration, the storage check, technical details
// ---------------------------------------------------------------------------

function AccelerationSheet({state, view, setSheet, recommendedSsdSize}: SheetProps) {
	const {t, i18n} = useStorageTranslation()
	const {accel, layout} = state.pool
	const needed = layout === 'stripe' ? 1 : 2
	const offer = getOffers(state, 'ssd').find((candidate) => candidate.id === 'accelerate')
	const on = accel.length > 0
	const room = state.pool.accelRoom
	const used = state.pool.accelUsed ?? 0
	return (
		<>
			<SheetHeader>
				<SheetTitle>{t('storage-ui.acceleration')}</SheetTitle>
				<SheetDescription>{t('storage-setup.accel.intro')}</SheetDescription>
			</SheetHeader>
			{on ? (
				<>
					<Rows>
						{accel.map((member) => {
							const drive = view.driveOf(member.id)
							if (!drive) return null
							const broken = isBroken(member)
							return (
								<button
									key={member.id}
									type='button'
									onClick={() => setSheet({type: 'drive', id: member.id})}
									className='text-left outline-hidden transition-colors hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-inset'
								>
									<DriveLine
										drive={drive}
										tone={broken ? 'failed' : 'in'}
										trailing={
											<span className={cn('shrink-0 text-13 font-medium', broken ? 'text-[#FF6B6B]' : 'text-white/50')}>
												{broken
													? t('storage-ui.state.failed')
													: member.state === 'rebuilding'
														? t('storage-mgr.drive.rebuilding')
														: t('storage-ui.health.healthy')}
											</span>
										}
									/>
								</button>
							)
						})}
					</Rows>
					{room !== undefined && (
						<div className='flex flex-col gap-2 rounded-17 bg-white/5 px-4 py-3'>
							<div className='flex items-baseline justify-between gap-3 text-13'>
								<span className='font-medium text-white/85'>{t('storage-mgr.accel.room')}</span>
								<span className='text-white/50'>
									{t('storage-mgr.accel.room.used', {used: formatSize(room * used), total: formatSize(room)})}
								</span>
							</div>
							<div className='flex h-1.5 w-full overflow-hidden rounded-full bg-white/10' aria-hidden>
								<div
									className={cn('h-full rounded-full', used > 0.7 ? 'bg-[#F5A623]' : 'bg-white/80')}
									style={{width: `${Math.min(100, used * 100)}%`}}
								/>
							</div>
							{used > 0.7 && <p className='text-12 leading-snug text-white/50'>{t('storage-mgr.accel.room.full')}</p>}
						</div>
					)}
					{offer?.blocked && <Note>{blockedSentence(t, offer.blocked, 'ssd', i18n.language)}</Note>}
				</>
			) : offer?.blocked ? (
				<Note>{blockedSentence(t, offer.blocked, 'ssd', i18n.language)}</Note>
			) : !offer ? (
				<Note>{t('storage-mgr.accel.add', {count: needed})}</Note>
			) : null}
			{!on && recommendedSsdSize && (
				<p className='px-1 text-12 leading-snug text-white/45'>
					{t('storage-setup.accel.recommended-size', {size: recommendedSsdSize})}
				</p>
			)}
			{/* What can't be undone about it, once it is on. Before that, turning it on says so. */}
			{on && <Note>{t(needed === 2 ? 'storage-setup.accel.permanent-two' : 'storage-setup.accel.permanent-one')}</Note>}
			<SheetFooter>
				{!on && offer && !offer.blocked && (
					<Button
						variant='primary'
						size='dialog'
						onClick={() => setSheet({type: 'new', kind: 'ssd', offer: 'accelerate'})}
					>
						{t('storage-mgr.action.turn-on-acceleration')}
					</Button>
				)}
				<Done setSheet={setSheet} />
			</SheetFooter>
		</>
	)
}

// umbreld reports whether a check is running and what it found, not when it last ran
function CheckSheet({state, view, setSheet, run, onOpenBackups}: SheetProps) {
	const {t} = useStorageTranslation()
	const request = useRun()
	const check = state.op?.kind === 'check' ? state.op : null
	const {dataErrors, layout} = state.pool
	const other = state.op && !check ? busyWith(state) : undefined
	return (
		<>
			<SheetHeader>
				<SheetTitle>{t('storage-mgr.check')}</SheetTitle>
				<SheetDescription>
					{t('storage-mgr.check.intro')}
					{layout !== 'stripe' && ` ${t('storage-mgr.check.repairs')}`}
				</SheetDescription>
			</SheetHeader>
			<Rows>
				<Row
					label={t('storage-ui.fact.status')}
					value={
						check ? (
							<span className='tabular-nums'>
								{t('storage-mgr.row.checking', {progress: Math.floor(check.progress)})}
							</span>
						) : (
							t('storage-mgr.row.every-30-days')
						)
					}
				/>
				{dataErrors > 0 && (
					<Row
						label={t('storage-mgr.check.found')}
						value={
							<span className='font-medium text-[#FF6B6B]'>{t('storage-mgr.check.errors', {count: dataErrors})}</span>
						}
					/>
				)}
			</Rows>
			{check && <ProgressBar value={check.progress} label={t('storage-mgr.check')} />}
			{dataErrors > 0 && (
				<Note tone='danger'>
					{t('storage-mgr.status.damage.body', {count: dataErrors})} {t('storage-mgr.status.damage.clears')}
				</Note>
			)}
			{other && <Note>{t('storage-ui.blocked.busy', {task: taskSentence(t, other.task, other.progress)})}</Note>}
			<RunError message={t('storage-mgr.failed.check')} error={request.error} />
			<SheetFooter>
				{dataErrors > 0 && (
					<Button variant='primary' size='dialog' onClick={onOpenBackups}>
						{t('storage-mgr.action.backups')}
					</Button>
				)}
				<Button
					variant={dataErrors > 0 ? 'default' : 'primary'}
					size='dialog'
					disabled={!!state.op || view.status === 'offline' || request.pending}
					onClick={() => request.run(() => run({type: 'check'}))}
				>
					{request.pending
						? t('storage-ui.starting')
						: check
							? t('storage-mgr.check.running')
							: t('storage-mgr.check.now')}
				</Button>
				<Done setSheet={setSheet} />
			</SheetFooter>
		</>
	)
}

function DetailsSheet({state, view, setSheet}: SheetProps) {
	const {t} = useStorageTranslation()
	const {layout, members, kind, accel} = state.pool
	const {capacity} = view
	const poolState =
		view.status === 'offline' ? 'UNAVAIL' : view.down.length || view.accelDown.length ? 'DEGRADED' : 'ONLINE'
	const paired = (state.pool.partialPairs?.length ?? 0) * 2
	const shape = state.pool.partialPairs
		? t('storage-mgr.details.shape.partial', {paired, single: members.length - paired})
		: layout === 'mirror'
			? t('storage-mgr.details.shape.mirror', {count: capacity.pairs.length})
			: t(`storage-mgr.details.shape.${layout}.${layout === 'stripe' ? kind : 'drive'}`, {count: members.length})
	const task = state.op ? taskSentence(t, state.op.kind, Math.floor(taskProgress(state.op) ?? 0)) : undefined
	return (
		<>
			<SheetHeader>
				<SheetTitle>{t('storage-ui.technical-details')}</SheetTitle>
				<SheetDescription>{t('storage-mgr.details.intro')}</SheetDescription>
			</SheetHeader>
			<Rows>
				<Row
					label={t('storage-mgr.details.layout')}
					hint={shape}
					trailing={<TechTag>{state.pool.partialPairs ? 'Stripe + Mirror' : layoutTech[layout]}</TechTag>}
				/>
				<Row label={t('storage-mgr.details.file-system')} trailing={<TechTag>ZFS</TechTag>} />
				<Row label={t('storage-mgr.details.state')} hint={task} trailing={<TechTag>{poolState}</TechTag>} />
				{accel.length > 0 && (
					<Row
						label={t('storage-ui.acceleration')}
						hint={t(accel.length === 2 ? 'storage-mgr.details.accel.pair' : 'storage-mgr.details.accel.single')}
						trailing={<TechTag>special + L2ARC</TechTag>}
					/>
				)}
			</Rows>
			<Rows>
				<Row label={t('storage-mgr.details.raw')} value={formatSize(capacity.raw)} />
				<Row label={t('storage-ui.available')} value={formatSize(capacity.usable)} />
				{capacity.protection > 0 && (
					<Row label={t('storage-manager.for-failsafe')} value={formatSize(capacity.protection)} />
				)}
				{capacity.unused > 0 && <Row label={t('storage-ui.unusable')} value={formatSize(capacity.unused)} />}
			</Rows>
			<SheetFooter>
				<Done setSheet={setSheet} />
			</SheetFooter>
		</>
	)
}

// ---------------------------------------------------------------------------
// Adding a drive, and bringing offline storage back
// ---------------------------------------------------------------------------

function InstallSheet({state, view, setSheet, onShutdown}: SheetProps) {
	const {t} = useStorageTranslation()
	const {layout, kind, members, accel} = state.pool
	const isPro = state.device === 'pro'
	const smallest = view.memberDrives.length ? Math.min(...view.memberDrives.map((drive) => drive.size)) : 0
	const proFull = isPro && view.freeSlots === 0
	const atLimit = layout === 'raidz1' && kind === 'hdd' && members.length >= MAX_HDD_RAIDZ1_DRIVES
	const size = formatSize(smallest)

	const gain =
		layout === 'stripe'
			? members.length === 1
				? t(`storage-mgr.install.gain.first.${kind}`, {size})
				: t(`storage-mgr.install.gain.full.${kind}`)
			: layout === 'mirror'
				? t('storage-mgr.install.gain.mirror')
				: t(`storage-mgr.install.gain.raidz.${kind}`, {size})

	return (
		<>
			<SheetHeader>
				<SheetTitle>{t(`storage-mgr.action.add.${kind}`)}</SheetTitle>
				<SheetDescription>
					{t(proFull || atLimit ? 'storage-mgr.install.full' : `storage-mgr.install.intro.${kind}`)}
				</SheetDescription>
			</SheetHeader>
			{proFull || atLimit ? (
				<Note>{t(proFull ? 'storage-mgr.install.full.pro' : 'storage-mgr.install.full.limit')}</Note>
			) : isPro ? (
				<>
					<ProInstallPhoto />
					<Steps
						steps={[
							t('storage-manager.install-ssd.pro-instructions-1'),
							t('storage-manager.install-ssd.pro-instructions-2'),
						]}
					/>
				</>
			) : (
				<Steps steps={[t(`storage-mgr.install.other.1.${kind}`), t('storage-mgr.install.other.2')]} />
			)}
			{!(proFull || atLimit) && (
				<p className='px-1 text-13 leading-snug text-white/55'>
					{gain}
					{kind === 'hdd' && accel.length === 0 && ` ${t('storage-mgr.install.ssd-accelerates')}`}
				</p>
			)}
			<SheetFooter>
				{isPro && !proFull && (
					<Button variant='primary' size='dialog' onClick={onShutdown}>
						{t('shut-down')}
					</Button>
				)}
				<Done setSheet={setSheet} />
			</SheetFooter>
		</>
	)
}

function OfflineSheet({state, setSheet, onShutdown, onRestart}: SheetProps) {
	const {t} = useStorageTranslation()
	const isPro = state.device === 'pro'
	return (
		<>
			<SheetHeader>
				<SheetTitle>{t('storage-mgr.offline.title')}</SheetTitle>
				<SheetDescription>{t('storage-mgr.offline.intro')}</SheetDescription>
			</SheetHeader>
			<Steps
				steps={[
					t('storage-mgr.offline.1'),
					t(isPro ? 'storage-mgr.offline.2.pro' : 'storage-mgr.offline.2.other'),
					t('storage-mgr.offline.3'),
				]}
			/>
			<Note>{t('storage-mgr.offline.gone')}</Note>
			<SheetFooter>
				<Button variant='primary' size='dialog' onClick={onShutdown}>
					{t('shut-down')}
				</Button>
				<Button size='dialog' onClick={onRestart}>
					{t('restart')}
				</Button>
				<Done setSheet={setSheet} />
			</SheetFooter>
		</>
	)
}
