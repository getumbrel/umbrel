// Setting up storage: one screen with Umbrel's own choice already made, and three places to
// change it (protection, drives, acceleration) for people who want to. The picture of the
// drives stays put the whole way through.
//
// It decides everything user.register takes for storage, and nothing else: finding the drives
// and creating the storage belong to the screens around it.

import {AnimatePresence, motion, useReducedMotion} from 'motion/react'
import {useMemo, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {IoShieldHalf} from 'react-icons/io5'
import {TbCheck, TbServer} from 'react-icons/tb'
import {useLocation, useNavigate} from 'react-router-dom'

import {Button} from '@/components/ui/button'
import {Switch} from '@/components/ui/switch'
import {primaryButtonProps} from '@/layouts/bare/shared'
import {cn} from '@/lib/utils'

import {AccelBay, ArtSection, DriveView, LevelGlyph, Size, SpaceBar, StorageArt, UnderTray} from '../art'
import {DriveFacts, TemperatureUnit} from '../drive-facts'
import {LevelDetails} from '../level-details'
import {
	Drive,
	DriveKind,
	formatSize,
	Hardware,
	isFailing,
	layoutTech,
	LeftOutReason,
	MAX_HDD_RAIDZ1_DRIVES,
	resolveSetup,
	Setup,
	SetupChoices,
	StorageConfig,
	toStorageConfig,
	troubleOf,
} from '../model'
import {
	DriveBanner,
	DriveLine,
	focusRing,
	Note,
	OptionCard,
	OptionGroup,
	PictureSide,
	Row,
	Rows,
	SectionLabel,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	sheetListClass,
	SheetRoot,
	SheetTitle,
	StepHeader,
	Tag,
	TextButton,
} from '../parts'
import {driveTitle, identityOf, problemLabel, promise, promiseSentence, troubleNote} from '../phrases'
import {forKind, useStorageTranslation} from '../words'

type View = 'hub' | 'protection' | 'drives' | 'acceleration'
const views: View[] = ['hub', 'protection', 'drives', 'acceleration']

// The pages inside the step are history entries, so the browser's Back returns to the step's
// first page instead of leaving it. Whatever the route keeps in its state travels along.
function useStepView() {
	const location = useLocation()
	const navigate = useNavigate()
	const params = new URLSearchParams(location.search)
	const view = views.find((candidate) => candidate === params.get('view')) ?? 'hub'
	const cameFromHub = !!(location.state as {storageStep?: boolean} | null)?.storageStep
	const open = (next: View) => {
		if (next === view) return
		if (next === 'hub') {
			if (cameFromHub) return navigate(-1)
			params.delete('view')
			return navigate({search: params.toString()}, {replace: true, state: location.state})
		}
		params.set('view', next)
		navigate({search: params.toString()}, {state: {...(location.state as object | null), storageStep: true}})
	}
	return [view, open] as const
}

// Why drives were left out by themselves. One drive that would hold the others back is named
// by its size, in a sentence of its own: a singular form can't carry what its plural doesn't.
function leftOutSentence(
	t: ReturnType<typeof useTranslation>['t'],
	reason: LeftOutReason,
	kind: DriveKind,
	count: number,
	size: number,
) {
	return reason === 'shrinks' && count === 1
		? t(`storage-setup.left-out.shrinks.single.${kind}`, {size: formatSize(size)})
		: t(`storage-setup.left-out.${reason}.${kind}`, {count})
}

export function StorageStep({
	hardware,
	earlierSetup,
	recommendedSsdSize,
	temperatureUnit = 'c',
	onContinue,
	onShutdown,
	onBack,
}: {
	hardware: Hardware
	// An earlier Umbrel setup is on these drives, and it will be erased
	earlierSetup?: boolean
	// The SSD size that suits this machine's memory, for acceleration
	recommendedSsdSize?: string
	temperatureUnit?: TemperatureUnit
	onContinue: (config: StorageConfig, setup: Setup) => void
	onShutdown: () => void
	// Back to the screen that offered to restore an earlier setup, for someone who chose to set
	// up as new and wants to see that choice again
	onBack?: () => void
}) {
	const {t: plainT} = useTranslation()
	const reduceMotion = useReducedMotion()
	const [view, open] = useStepView()
	const [choices, setChoices] = useState<SetupChoices>({})
	const [confirming, setConfirming] = useState(false)
	const [shuttingDown, setShuttingDown] = useState(false)
	// The drive whose details are open
	const [infoId, setInfoId] = useState<string | null>(null)
	const setup = useMemo(() => resolveSetup(hardware, choices), [hardware, choices])
	const recommended = useMemo(() => resolveSetup(hardware), [hardware])
	const isPro = hardware.device === 'pro'
	const usable = hardware.drives.filter((drive) => !drive.system)
	const kind = setup.kind
	// A machine with only SSDs is told about SSDs, never "drives"
	const onlySsds = usable.every((drive) => drive.kind === 'ssd')
	const noun = onlySsds ? 'ssd' : 'drive'
	const t = forKind(plainT, noun)

	// Choosing what Umbrel would have chosen anyway still counts as its choice
	const sameDrives = ids(setup.selected) === ids(recommended.selected) && setup.kind === recommended.kind

	const change = (next: SetupChoices) => setChoices((current) => ({...current, ...next}))
	const go = (next: View) => open(next)

	const selectedIds = setup.selected.map((drive) => drive.id)
	const hasBothKinds = usable.some((drive) => drive.kind === 'hdd') && usable.some((drive) => drive.kind === 'ssd')
	const smallest = setup.selected.length ? Math.min(...setup.selected.map((drive) => drive.size)) : 0
	const infoDrive = hardware.drives.find((drive) => drive.id === infoId)
	const first = setup.selected[0]
	const accelCount = setup.accel.chosen.length

	const toggleDrive = (id: string) => {
		const isCandidate = setup.candidates.some((drive) => drive.id === id)
		if (!isCandidate) return
		const next = selectedIds.includes(id) ? selectedIds.filter((other) => other !== id) : [...selectedIds, id]
		// Choosing drives never changes the mode by itself: it stays what it was when the choosing began
		if (next.length > 0) change({selected: next, protect: setup.protect})
	}

	const toggleAccelerator = (id: string) => {
		const current = setup.accel.chosen.map((drive) => drive.id)
		let next = current.includes(id) ? current.filter((other) => other !== id) : [...current, id]
		if (next.length > setup.accel.needed) next = next.slice(next.length - setup.accel.needed)
		// One SSD short of what's needed simply means acceleration is off
		change({accel: next.length === setup.accel.needed ? next : next.length === 0 ? false : next})
	}

	const driveViews = buildViews(hardware, setup, t)
	// A drive that is left out is space this setup doesn't reach, so the bar counts it with the
	// rest of what is unusable, as the picture draws it
	const leftOutSize = setup.leftOut.reduce((sum, entry) => sum + entry.drive.size, 0)
	const shownCapacity = {...setup.capacity, unused: setup.capacity.unused + leftOutSize}
	const accelViews: DriveView[] = setup.accel.chosen.map((drive) => {
		const trouble = troubleOf(drive)
		return {id: drive.id, drive, tone: trouble ? 'warning' : 'in', note: trouble ? troubleNote(t, trouble) : undefined}
	})
	// Drives the machine has that this setup leaves alone: the other kind, or the one umbrelOS runs from
	const idle = [
		...setup.others.filter((drive) => !setup.accel.chosen.includes(drive)),
		...(setup.system ? [setup.system] : []),
	]

	// A tap on a drive means whatever is being decided: take it in or out, or simply ask what it is
	const mode = view === 'drives' ? 'select' : 'info'
	const onPick = mode === 'select' ? toggleDrive : (id: string) => setInfoId(id)

	// Whatever about the drives most needs saying, beside the choices it follows from
	const notes: {tone: 'neutral' | 'warning'; text: string}[] = []
	if (setup.allFailing) {
		notes.push({tone: 'warning', text: t(`storage-setup.note.all-failing.${kind}`, {count: setup.candidates.length})})
	} else if (setup.selected.some(isFailing)) {
		notes.push({tone: 'warning', text: t(`storage-setup.note.failing-included.${kind}`)})
	}
	if (setup.levelChanged) {
		notes.push({
			tone: 'neutral',
			// The modes are named as their cards name them
			text: t(`storage-setup.note.level-changed.${setup.levelChanged.from}.${setup.levelChanged.to}`, {
				from: promise(t, setup.levelChanged.from, kind),
				to: promise(t, setup.levelChanged.to, kind),
			}),
		})
	}
	const autoLeftOut = setup.leftOut.filter((entry) => entry.reason !== 'choice')
	if (autoLeftOut.length > 0) {
		const reason = autoLeftOut[0].reason
		const same = autoLeftOut.filter((entry) => entry.reason === reason)
		notes.push({
			tone: 'neutral',
			text: leftOutSentence(t, reason, kind, same.length, same[0].drive.size),
		})
	} else if (setup.capacity.unused > 0) {
		notes.push({
			tone: 'neutral',
			text:
				setup.layout === 'mirror'
					? t('storage-setup.note.unusable-pairs', {unusable: formatSize(setup.capacity.unused)})
					: t(`storage-setup.note.unusable.${kind}`, {
							size: formatSize(smallest),
							unusable: formatSize(setup.capacity.unused),
						}),
		})
	}
	if (!setup.allFailing && setup.selected.some((drive) => troubleOf(drive) === 'worn')) {
		notes.push({tone: 'warning', text: t('storage-setup.note.worn')})
	}

	// What can't be undone about the choice that is made, said where it is made
	const permanence: {tone: 'neutral' | 'warning'; text: string} | null = setup.protect
		? {tone: 'neutral', text: t('storage-setup.permanent.failsafe')}
		: setup.selected.length < 2
			? null
			: kind === 'ssd'
				? {tone: 'warning', text: t('storage-setup.permanent.full-ssd')}
				: {tone: 'neutral', text: t('storage-setup.permanent.full-hdd')}

	// How this choice gets more space later, said under the choice
	const growth = growSentence(t, hardware, setup)

	const drivesValue =
		setup.selected.length < setup.candidates.length
			? t(`storage-setup.drives.some.${kind}`, {count: setup.selected.length, total: setup.candidates.length})
			: t(`storage-setup.drives.all.${kind}`, {count: setup.selected.length})

	// The best any level does with these drives: "The most space" is only said when it's true
	const mostUsable = Math.max(
		...setup.levels.filter((option) => !option.problem).map((option) => option.capacity.usable),
	)

	// Adding or removing drives means shutting down first. It is offered under the drives.
	const changeDrives = (
		<TextButton onClick={() => setShuttingDown(true)} className='mt-1 self-center'>
			{t(`storage-setup.change-drives.${noun}`)}
		</TextButton>
	)

	// What the choice comes to, as a bar. Beside the picture where the two sit side by side. On a
	// phone the picture is a screen or two further down, so the bar goes right under the choice.
	const phoneBar = (
		<div className='px-2 pt-1.5 pb-1 two-up:hidden'>
			<SpaceBar capacity={shownCapacity} />
		</div>
	)

	return (
		<div className='flex min-h-0 flex-1 flex-col'>
			{/* The footer stays put: on a phone the page scrolls above it, on a desktop each side scrolls
			    by itself. On Umbrel Pro the tray runs off the card's right edge, as its photo does.
			    A tablet has the two sides too, each about as wide as a phone, so neither is squeezed. */}
			<div
				className={cn(
					'flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto lg:gap-10 two-up:flex-row two-up:overflow-hidden two-up:max-lg:gap-6 one-up:[mask-image:linear-gradient(to_bottom,black_calc(100%-24px),transparent)]',
					isPro && '-mr-4 md:-mr-6',
				)}
			>
				{/* Left: what's being decided */}
				<div
					className={cn(
						'@container flex min-w-0 shrink-0 flex-col lg:w-[440px] two-up:overflow-y-auto two-up:pt-4 two-up:pr-1 two-up:pl-2 two-up:max-lg:w-[52%]',
						// What scrolls out of a side fades out, instead of being cut at the footer's line
						'two-up:[mask-image:linear-gradient(to_bottom,black_calc(100%-20px),transparent)] two-up:pb-5',
						isPro && 'one-up:pr-4',
					)}
				>
					<AnimatePresence mode='wait' initial={false}>
						<motion.div
							key={view}
							initial={reduceMotion ? false : {opacity: 0, x: view === 'hub' ? -10 : 10}}
							animate={{opacity: 1, x: 0}}
							exit={reduceMotion ? undefined : {opacity: 0, x: view === 'hub' ? -10 : 10}}
							transition={{duration: 0.16, ease: 'easeOut'}}
							className='flex flex-col gap-5'
						>
							{view === 'hub' && (
								<>
									<StepHeader title={t('storage-setup.title')} onBack={onBack}>
										{foundSentence(usable, t)}
									</StepHeader>

									{hasBothKinds && <KindChooser kind={kind} onChange={(next) => setChoices({kind: next})} />}

									<div className='flex flex-col gap-2'>
										<OptionGroup label={t('storage-setup.mode')}>
											<OptionCard
												selected={setup.protect}
												onSelect={() => change({protect: true})}
												icon={<IoShieldHalf className='size-5' />}
												title={t('storage-ui.failsafe')}
												badge={
													recommended.recommendProtect && sameDrives ? (
														<Tag>{t('storage-ui.recommended')}</Tag>
													) : undefined
												}
												value={<Size bytes={setup.failsafeUsable} />}
												description={
													setup.canProtect && setup.level
														? promiseSentence(t, setup.level, kind, setup.accel.available.length >= 2 ? accelCount : 0)
														: t(`storage-setup.failsafe-later.${kind}`, {size: first ? formatSize(first.size) : ''})
												}
												disabledReason={setup.canProtect ? null : t(`storage-setup.needs-two.${kind}`)}
											/>
											<OptionCard
												selected={!setup.protect}
												onSelect={() => change({protect: false})}
												icon={<TbServer className='size-5' />}
												title={t('storage-ui.full-storage')}
												value={<Size bytes={setup.storageUsable} />}
												description={
													setup.candidates.length === 1
														? t(`storage-setup.full.one.${kind}`)
														: t(`storage-setup.full.many.${noun}`)
												}
											/>
										</OptionGroup>
										{phoneBar}
										{growth && <p className='px-2 text-12 leading-snug text-balance text-white/50'>{growth}</p>}
									</div>
									{/* Notes stand apart from the choice, as on every other page, not tucked under it */}
									{permanence && <Note tone={permanence.tone}>{permanence.text}</Note>}

									{((setup.protect && kind === 'hdd') ||
										setup.candidates.length > 1 ||
										setup.accel.available.length > 0) && (
										<Rows>
											{setup.protect && kind === 'hdd' && setup.level && (
												<Row
													label={t('storage-setup.protection')}
													value={promise(t, setup.level, kind)}
													onClick={() => go('protection')}
												/>
											)}
											{setup.candidates.length > 1 && (
												<Row
													label={t(`storage-setup.drives.label.${noun}`)}
													value={drivesValue}
													onClick={() => go('drives')}
												/>
											)}
											{setup.accel.available.length > 0 && (
												<Row
													label={t('storage-ui.acceleration')}
													value={
														accelCount > 0
															? t('storage-setup.on')
															: setup.accel.available.length < setup.accel.needed
																? t('storage-setup.accel.needs-two')
																: t('storage-setup.off')
													}
													onClick={() => go('acceleration')}
												/>
											)}
										</Rows>
									)}

									{notes.map((note) => (
										<Note key={note.text} tone={note.tone}>
											{note.text}
										</Note>
									))}
								</>
							)}

							{view === 'protection' && (
								<>
									<StepHeader title={t('storage-setup.protection')} onBack={() => go('hub')}>
										{t('storage-setup.protection.intro')}
									</StepHeader>
									<div className='flex flex-col gap-2'>
										<OptionGroup label={t('storage-setup.protection')}>
											{setup.levels.map((option) => {
												const limited =
													option.layout === 'raidz1' &&
													option.drives.length < setup.candidates.filter((d) => !isFailing(d)).length
												return (
													<OptionCard
														key={option.layout}
														selected={setup.level === option.layout}
														onSelect={() => change({level: option.layout})}
														icon={
															<LevelGlyph
																layout={option.layout}
																count={option.drives.length || setup.selected.length}
															/>
														}
														iconCaption={layoutTech[option.layout]}
														title={promise(t, option.layout, kind)}
														badge={
															option.recommended && sameDrives && recommended.recommendProtect ? (
																<Tag>{t('storage-ui.recommended')}</Tag>
															) : undefined
														}
														value={<Size bytes={option.capacity.usable} />}
														description={
															option.layout === 'raidz1'
																? limited && option.drives.length === MAX_HDD_RAIDZ1_DRIVES
																	? t('storage-setup.level.raidz1.limited', {
																			used: option.drives.length,
																			total: setup.candidates.length,
																		})
																	: option.capacity.usable >= mostUsable
																		? t('storage-setup.level.raidz1.most')
																		: t('storage-setup.level.raidz1')
																: t(`storage-setup.level.${option.layout}`)
														}
														disabledReason={option.problem ? problemLabel(t, option.problem) : null}
													/>
												)
											})}
										</OptionGroup>
										{phoneBar}
									</div>
									<Note>{t('storage-setup.permanent.level')}</Note>
									{notes.map((note) => (
										<Note key={note.text} tone={note.tone}>
											{note.text}
										</Note>
									))}
									<LevelDetails layouts={setup.levels.map((option) => option.layout)} selected={setup.level} />
								</>
							)}

							{view === 'drives' && (
								<>
									<StepHeader title={t(`storage-setup.drives.label.${noun}`)} onBack={() => go('hub')}>
										{t(`storage-setup.drives.intro.${noun}`)}
									</StepHeader>
									{/* The picture is where drives are chosen. This side says what the choice comes to. */}
									<div className='flex items-baseline justify-between gap-3 rounded-17 bg-white/5 px-4 py-3'>
										<span className='text-15 font-semibold text-white'>{drivesValue}</span>
										<span className='text-13 text-white/50'>
											{t('storage-setup.size-available', {size: formatSize(setup.capacity.usable)})}
										</span>
									</div>
									{phoneBar}
									{setup.leftOut.length > 0 && (
										<div className='flex flex-col gap-1.5'>
											<SectionLabel className='px-1 text-12'>{t('storage-setup.drives.left-out')}</SectionLabel>
											<Rows>
												{sortBySlot(setup.leftOut.map((entry) => entry.drive)).map((drive) => {
													const entry = setup.leftOut.find((candidate) => candidate.drive.id === drive.id)!
													return (
														<DriveLine
															key={drive.id}
															drive={drive}
															slot={drive.slot}
															tone={isFailing(drive) ? 'warning' : 'out'}
															detail={
																entry.reason === 'choice'
																	? undefined
																	: leftOutSentence(t, entry.reason, kind, 1, drive.size)
															}
														/>
													)
												})}
											</Rows>
										</div>
									)}
									{setup.system && (
										<Rows>
											<DriveLine
												drive={setup.system}
												tone='out'
												detail={t('storage-setup.system-drive')}
												trailing={<Tag>{t('storage-setup.system')}</Tag>}
											/>
										</Rows>
									)}
									{notes
										.filter((note) => note.tone === 'warning' || setup.levelChanged)
										.map((note) => (
											<Note key={note.text} tone={note.tone}>
												{note.text}
											</Note>
										))}
								</>
							)}

							{view === 'acceleration' && (
								<>
									<StepHeader title={t('storage-ui.acceleration')} onBack={() => go('hub')}>
										{t('storage-setup.accel.intro')}
									</StepHeader>
									{setup.accel.available.length < setup.accel.needed ? (
										<Note>{t('storage-setup.accel.one-short')}</Note>
									) : (
										<>
											<Rows>
												<label className='flex min-h-[52px] cursor-pointer items-center gap-3 px-4 py-2.5'>
													<span className='flex-1 text-14 font-medium text-white/85'>
														{t('storage-setup.accel.use')}
													</span>
													<Switch
														checked={accelCount > 0}
														onCheckedChange={(checked) => change({accel: checked ? undefined : false})}
														aria-label={t('storage-setup.accel.use')}
													/>
												</label>
												{accelCount > 0 &&
													setup.accel.available.length > setup.accel.needed &&
													setup.accel.available.map((drive) => {
														const chosen = setup.accel.chosen.some((other) => other.id === drive.id)
														return (
															<button
																key={drive.id}
																type='button'
																role='checkbox'
																aria-checked={chosen}
																onClick={() => toggleAccelerator(drive.id)}
																className='text-left outline-hidden transition-colors hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-inset'
															>
																<DriveLine
																	drive={drive}
																	tone={chosen ? 'in' : 'out'}
																	trailing={
																		<span
																			className={cn(
																				'flex size-[22px] items-center justify-center rounded-full border transition-colors',
																				chosen ? 'border-white bg-white' : 'border-white/30',
																			)}
																		>
																			{chosen && <TbCheck className='size-3.5 text-black' strokeWidth={3.5} />}
																		</span>
																	}
																/>
															</button>
														)
													})}
											</Rows>
											{accelCount > 0 && (
												<Note>
													{t(
														setup.accel.needed === 2
															? 'storage-setup.accel.permanent-two'
															: 'storage-setup.accel.permanent-one',
													)}{' '}
													{t(setup.accel.needed === 2 ? 'storage-setup.accel.mirrored' : 'storage-setup.accel.single')}
													{accelCount === 2 &&
														setup.accel.chosen[0].size !== setup.accel.chosen[1].size &&
														` ${t('storage-setup.accel.mismatch', {size: formatSize(Math.min(...setup.accel.chosen.map((drive) => drive.size)))})}`}
												</Note>
											)}
										</>
									)}
									{recommendedSsdSize && (
										<p className='px-2 text-12 leading-snug text-white/45'>
											{t('storage-setup.accel.recommended-size', {size: recommendedSsdSize})}
										</p>
									)}
								</>
							)}
						</motion.div>
					</AnimatePresence>
				</div>

				{/* Right: the same picture throughout */}
				<PictureSide isPro={isPro}>
					{/* When the picture has another part, acceleration SSDs or drives that aren't used, the
						    drives that hold the files get a heading too */}
					<ArtSection
						title={(accelViews.length > 0 || idle.length > 0) && !isPro ? t('storage-ui.storage') : undefined}
					>
						<StorageArt
							device={hardware.device}
							drives={driveViews}
							pairs={setup.layout === 'mirror' ? setup.capacity.pairs : []}
							mode={mode}
							onPick={onPick}
							pickedIds={selectedIds}
						/>
						{/* The bar sums these drives up, so it stays with them, above any part that follows.
							    A phone has it under the choice instead, and Umbrel Pro under its tray. */}
						{!isPro && (
							<div className='flex w-full flex-col items-center px-2 pt-2.5 one-up:hidden'>
								<SpaceBar capacity={shownCapacity} className='max-w-[340px]' />
							</div>
						)}
					</ArtSection>
					<AccelBay
						drives={accelViews}
						mode='info'
						onPick={setInfoId}
						className={cn(view === 'drives' && 'opacity-50')}
					/>
					{/* Under Umbrel Pro's tray the bar is as wide as its four slots */}
					{isPro && (
						<UnderTray>
							<SpaceBar capacity={shownCapacity} className='one-up:hidden' />
							{changeDrives}
						</UnderTray>
					)}
					{idle.length > 0 && (
						<ArtSection title={t('storage-setup.idle')} className={cn('mt-2', isPro && 'pr-4 md:pr-6')}>
							<Rows>
								{idle.map((drive) => (
									<DriveLine
										key={drive.id}
										drive={drive}
										tone={isFailing(drive) ? 'warning' : 'out'}
										detail={
											drive.system
												? t('storage-setup.idle.system')
												: isFailing(drive)
													? t('storage-ui.health.failing')
													: kind === 'ssd'
														? t('storage-setup.idle.other-kind')
														: accelCount > 0
															? t('storage-setup.idle.spare-ssd')
															: setup.accel.available.length < setup.accel.needed
																? t('storage-setup.idle.one-short')
																: t('storage-setup.idle.could-accelerate')
										}
									/>
								))}
							</Rows>
						</ArtSection>
					)}
					{/* Under the drives, where changing them belongs. Umbrel Pro has it under its tray. */}
					{!isPro && changeDrives}
				</PictureSide>
			</div>

			<div className='mt-5 flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-5 two-up:px-2'>
				<span />
				{view === 'hub' ? (
					<button {...primaryButtonProps} onClick={() => setConfirming(true)}>
						{t('continue')}
					</button>
				) : (
					<button {...primaryButtonProps} onClick={() => go('hub')}>
						{t('done')}
					</button>
				)}
			</div>

			{/* The one place anything is erased, and so the one place that asks */}
			<SheetRoot open={confirming} onOpenChange={setConfirming}>
				<SheetContent>
					<SheetHeader>
						<SheetTitle>
							{t(`storage-setup.erase.title.${setup.erased.every((drive) => drive.kind === 'ssd') ? 'ssd' : 'drive'}`, {
								count: setup.erased.length,
							})}
						</SheetTitle>
						<SheetDescription>
							{earlierSetup
								? t('storage-setup.erase.earlier')
								: t('storage-setup.erase.body', {count: setup.erased.length})}
							{usable.length > setup.erased.length &&
								` ${t('storage-setup.erase.others', {count: usable.length - setup.erased.length})}`}
						</SheetDescription>
					</SheetHeader>
					<div className={cn('flex flex-col divide-y divide-white/[0.06] rounded-12 bg-white/5', sheetListClass)}>
						{sortBySlot(setup.erased).map((drive) => (
							<DriveLine
								key={drive.id}
								drive={drive}
								slot={drive.slot}
								detail={
									setup.accel.chosen.includes(drive)
										? `${t('storage-ui.acceleration')} - ${identityOf(drive)}`
										: undefined
								}
								className='min-h-[52px]'
							/>
						))}
					</div>
					<SheetFooter>
						<Button
							variant={earlierSetup ? 'destructive' : 'primary'}
							size='dialog'
							onClick={() => {
								setConfirming(false)
								onContinue(toStorageConfig(setup), setup)
							}}
						>
							{t('storage-setup.erase.confirm')}
						</Button>
						<Button size='dialog' onClick={() => setConfirming(false)}>
							{t('cancel')}
						</Button>
					</SheetFooter>
				</SheetContent>
			</SheetRoot>

			<SheetRoot open={!!infoDrive} onOpenChange={(isOpen) => !isOpen && setInfoId(null)}>
				{infoDrive && (
					<SheetContent>
						<SheetHeader>
							<SheetTitle>{driveTitle(t, infoDrive)}</SheetTitle>
						</SheetHeader>
						<DriveBanner
							drive={infoDrive}
							tone={
								troubleOf(infoDrive)
									? 'warning'
									: selectedIds.includes(infoDrive.id) || setup.accel.chosen.includes(infoDrive)
										? 'in'
										: 'out'
							}
						/>
						<DriveFacts
							drive={infoDrive}
							unit={temperatureUnit}
							use={
								infoDrive.system
									? t('storage-setup.idle.system')
									: selectedIds.includes(infoDrive.id)
										? setup.protect
											? t('storage-ui.use.failsafe')
											: t('storage-ui.use.storage')
										: setup.accel.chosen.includes(infoDrive)
											? t('storage-ui.acceleration')
											: t('storage-ui.use.none')
							}
						/>
						{leftOutHint(t, setup, infoDrive) && <Note>{leftOutHint(t, setup, infoDrive)}</Note>}
						<SheetFooter>
							<Button size='dialog' onClick={() => setInfoId(null)}>
								{t('done')}
							</Button>
						</SheetFooter>
					</SheetContent>
				)}
			</SheetRoot>

			<ShutDownDialog
				isPro={isPro}
				ssd={onlySsds}
				open={shuttingDown}
				onOpenChange={setShuttingDown}
				onShutdown={onShutdown}
				reason='change'
			/>
		</div>
	)
}

// ---------------------------------------------------------------------------

type T = ReturnType<typeof useTranslation>['t']

// Why a drive is left out, and what would bring it in
function leftOutHint(t: T, setup: Setup, drive: Drive): string | undefined {
	const entry = setup.leftOut.find((candidate) => candidate.drive.id === drive.id)
	if (!entry) return undefined
	// The size every drive would come down to with this one in
	return t(`storage-setup.left-out.hint.${entry.reason}`, {size: formatSize(drive.size)})
}

// How the storage that is being set up gets more space later: what to add, or what to replace
// when nothing more can go in. umbreld adds drives to one- and two-drive FailSafe 1 at a time,
// pairs 2 at a time, and anything to Full Storage.
function growSentence(t: T, hardware: Hardware, setup: Setup): string | undefined {
	const {kind, layout, selected} = setup
	if (selected.length === 0) return undefined
	const size = formatSize(Math.min(...selected.map((drive) => drive.size)))
	// Umbrel Pro has 4 slots, and an SSD that is left out still sits in one
	const proFull = hardware.device === 'pro' && hardware.drives.filter((drive) => drive.slot).length >= 4
	if (layout === 'stripe') {
		if (proFull) return t('storage-setup.grow.full.pro-full')
		if (selected.length === 1) return t(`storage-setup.grow.first.${kind}`)
		return t(`storage-setup.grow.full.${kind}`)
	}
	if (layout === 'mirror') return t('storage-setup.grow.mirror')
	if (proFull) return t('storage-setup.grow.pro-full')
	if (layout === 'raidz1' && kind === 'hdd' && selected.length >= MAX_HDD_RAIDZ1_DRIVES)
		return t('storage-setup.grow.limit')
	return t(`storage-setup.grow.${kind === 'ssd' ? 'raidz1' : layout}.${kind}`, {size})
}

function buildViews(hardware: Hardware, setup: Setup, t: T): DriveView[] {
	const selected = new Set(setup.selected.map((drive) => drive.id))
	const make = (drive: Drive): DriveView => {
		const included = selected.has(drive.id)
		// A drive that is left out is space the storage can't reach, all of it: it is drawn the
		// way unusable space is, and says why
		const unusable = included ? (setup.capacity.shares[drive.id]?.unused ?? 0) : drive.size
		const trouble = troubleOf(drive)
		return {
			id: drive.id,
			drive,
			tone: !included ? 'out' : trouble ? 'warning' : 'in',
			note: !included
				? t('storage-setup.left-out')
				: trouble
					? troubleNote(t, trouble)
					: unusable > 0
						? t('storage-setup.unusable', {size: formatSize(unusable)})
						: undefined,
			unusable: unusable || undefined,
			split:
				included && !trouble && unusable > 0 && unusable < drive.size
					? {usable: drive.size - unusable, unusable}
					: undefined,
			// A drive that is left out because it is failing keeps saying so
			alert: !included && trouble ? 'attention' : undefined,
			hint: included ? undefined : leftOutHint(t, setup, drive),
		}
	}
	const candidates = hardware.drives.filter((drive) => drive.kind === setup.kind && !drive.system)
	// Umbrel Pro's SSDs go to their slots, wherever they sit in the list
	if (hardware.device === 'pro') return candidates.map(make)

	// The two drives of a pair stand together, then anything left out. Drives of the other kind
	// aren't part of this picture: they're listed beneath it.
	const ordered =
		setup.layout === 'mirror'
			? setup.capacity.pairs.flatMap((pair) => pair).map((id) => setup.selected.find((drive) => drive.id === id)!)
			: setup.selected
	return [...ordered, ...setup.leftOut.map((entry) => entry.drive)].map(make)
}

const ids = (drives: Drive[]) =>
	drives
		.map((drive) => drive.id)
		.sort()
		.join()

// Umbrel Pro's SSDs are listed in the order of their slots, as the tray shows them
const sortBySlot = (drives: Drive[]) => [...drives].sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99))

// "Umbrel found 4 hard drives of 8TB each. It also found 2 SSDs of 1TB each."
function foundSentence(drives: Drive[], t: T): string {
	const part = (kind: DriveKind, also: boolean) => {
		const list = drives.filter((drive) => drive.kind === kind)
		if (list.length === 0) return null
		const same = list.every((drive) => drive.size === list[0].size)
		return t(`storage-setup.${also ? 'also' : 'found'}.${kind}-${same ? 'same' : 'mixed'}`, {
			count: list.length,
			size: formatSize(list[0].size),
		})
	}
	const hdds = part('hdd', false)
	return [hdds, part('ssd', !!hdds)].filter(Boolean).join(' ')
}

// With both kinds in the machine, which one holds the storage is the person's to choose
function KindChooser({kind, onChange}: {kind: DriveKind; onChange: (kind: DriveKind) => void}) {
	const {t} = useStorageTranslation()
	return (
		<div className='flex flex-col gap-2'>
			<SectionLabel className='px-1'>{t('storage-setup.kind.label')}</SectionLabel>
			<div
				role='radiogroup'
				aria-label={t('storage-setup.kind.label')}
				className='flex gap-1 rounded-full bg-white/[0.07] p-1'
			>
				{(['hdd', 'ssd'] as DriveKind[]).map((option) => (
					<button
						key={option}
						type='button'
						role='radio'
						aria-checked={kind === option}
						onClick={() => onChange(option)}
						className={cn(
							'flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-full py-1.5 text-13 font-medium transition-colors',
							focusRing,
							kind === option ? 'bg-white/90 text-black' : 'text-white/70 hover:text-white',
						)}
					>
						{/* A segmented control alone reads as tabs. An accent disc with a tick on the one chosen and
						    an empty ring on the other say it is a choice, like a radio button. Both are 12px
						    across in the same 14px, so the label doesn't move when the choice changes. */}
						<span aria-hidden className='flex size-3.5 shrink-0 items-center justify-center'>
							{kind === option ? (
								// The accent disc and white tick of the chosen card below, at the empty ring's 12px.
								// One drawing, so the tick can't sit a pixel off centre in its disc, and a heavier
								// stroke than the card's so it still reads at this size.
								<svg viewBox='0 0 12 12' className='size-3 shrink-0'>
									<circle cx='6' cy='6' r='6' className='fill-brand' />
									<path
										d='M3.4 6.2 5.2 8l3.4-3.6'
										fill='none'
										stroke='white'
										strokeWidth={1.8}
										strokeLinecap='round'
										strokeLinejoin='round'
									/>
								</svg>
							) : (
								<span className='size-3 rounded-full border-[1.5px] border-current' />
							)}
						</span>
						{t(`storage-setup.kind.${option}`)}
					</button>
				))}
			</div>
			{/* Only the choice with a consequence says so: with SSDs chosen, the hard drives go unused */}
			{kind === 'ssd' && <p className='px-1 text-12 leading-snug text-white/45'>{t('storage-setup.kind.ssd.note')}</p>}
		</div>
	)
}

export function ShutDownDialog({
	isPro,
	ssd = isPro,
	open,
	onOpenChange,
	onShutdown,
	reason,
}: {
	isPro: boolean
	// The machine has nothing but SSDs, so it is told about SSDs
	ssd?: boolean
	open: boolean
	onOpenChange: (open: boolean) => void
	onShutdown: () => void
	// To add or remove drives, to look at them after setup went wrong, or to look at them
	// because the storage wouldn't start
	reason: 'change' | 'check' | 'storage'
}) {
	const {t: plainT} = useTranslation()
	const t = forKind(plainT, ssd ? 'ssd' : 'drive')
	return (
		<SheetRoot open={open} onOpenChange={onOpenChange}>
			<SheetContent>
				<SheetHeader>
					<SheetTitle>{t(`storage-setup.shutdown.${reason}.title`)}</SheetTitle>
					<SheetDescription>{t(`storage-setup.shutdown.${reason}.${isPro ? 'pro' : 'other'}`)}</SheetDescription>
				</SheetHeader>
				<SheetFooter>
					<Button
						variant='primary'
						size='dialog'
						onClick={() => {
							onOpenChange(false)
							onShutdown()
						}}
					>
						{t('shut-down')}
					</Button>
					<Button size='dialog' onClick={() => onOpenChange(false)}>
						{t('cancel')}
					</Button>
				</SheetFooter>
			</SheetContent>
		</SheetRoot>
	)
}
