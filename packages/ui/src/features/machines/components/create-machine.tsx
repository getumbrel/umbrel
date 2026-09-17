import {ChevronDown, Eye, EyeOff, Pencil, TriangleAlert} from 'lucide-react'
import {AnimatePresence, motion} from 'motion/react'
import {lazy, Suspense, useEffect, useId, useState} from 'react'
import {FaLock} from 'react-icons/fa6'
import {Navigate, useNavigate, useSearchParams} from 'react-router-dom'

import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {Spinner} from '@/components/ui/loading'
import {OsIcon} from '@/features/machines/components/os-icon'
import {SpecRow, Stepper} from '@/features/machines/components/spec-form'
import {
	DEFAULT_CORES,
	DEFAULT_MEMORY_GB,
	diskStepGb,
	getMachineSpecProfile,
	getOsVisuals,
	hostReservedMemoryBytes,
	layoutMorphTransition,
	machinePath,
	MACHINES_ADD_PATH,
	MACHINES_PATH,
	MAX_DISK_SIZE_GB,
	MIN_MEMORY_GB,
	recommendedCores,
} from '@/features/machines/constants'
import {useMachineActions} from '@/features/machines/hooks/use-machine-actions'
import {useMachineCapabilities, useMachines, useOsImages} from '@/features/machines/hooks/use-machines'
import {stripDiskImageExtension} from '@/features/machines/utils'
import {useCpu} from '@/hooks/use-cpu'
import {useMemory} from '@/hooks/use-memory'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

const MiniBrowser = lazy(() =>
	import('@/features/files/components/mini-browser').then((m) => ({default: m.MiniBrowser})),
)

function nextAvailableName(base: string, existingNames: string[]) {
	const used = new Set(existingNames.map((value) => value.trim().toLowerCase()))
	if (!used.has(base.toLowerCase())) return base
	for (let suffix = 2; ; suffix++) {
		const candidate = `${base} ${suffix}`
		if (!used.has(candidate.toLowerCase())) return candidate
	}
}

// Configure and create a machine from any catalog image (?os=<osId>) or a
// custom installer/disk image file (?iso=<path>). Catalog downloads begin only
// after submission, so users never have to babysit a separate pre-cache step.
export default function CreateMachine() {
	const navigate = useNavigate()
	const [searchParams] = useSearchParams()
	const osId = searchParams.get('os')
	const isoPath = searchParams.get('iso')

	const {osImages, isLoading} = useOsImages()
	const {capabilities} = useMachineCapabilities()
	const {machines} = useMachines()
	const {create} = useMachineActions()
	const {threads} = useCpu()
	const {data: memoryData} = useMemory()
	const userQ = trpcReact.user.get.useQuery()

	const osImage = osId ? osImages.find((image) => image.id === osId) : undefined

	// Catalog images can use credentials to preconfigure the guest. A manual
	// installer may only be able to prefill the username; custom images never do.
	const requiresCredentials = !!osImage?.requiresCredentials
	const manualSetup = !!osImage?.manualSetup
	const requiresPassword = requiresCredentials && !manualSetup
	const requiresLicenseKey = !!osImage?.requiresLicenseKey
	const requiresWindowsUsername = osImage?.platform === 'windows'
	const fixedMemoryGb = osImage?.fixedMemoryMb ? osImage.fixedMemoryMb / 1_024 : undefined

	// What this OS actually wants, and the floor it can't install below. Custom
	// images fall back to generic specs — we know nothing about what's inside.
	const profile = getMachineSpecProfile(osImage)

	// RAM bounds: 1GB → (host total − reserved)
	const reservedBytes = hostReservedMemoryBytes(memoryData)
	const maxMemoryGb = memoryData
		? Math.max(MIN_MEMORY_GB, Math.floor((memoryData.size - reservedBytes) / 1e9))
		: undefined

	const [name, setName] = useState<string | null>(null)
	const [editingName, setEditingName] = useState(false)
	const [diskSizeInput, setDiskSizeInput] = useState(String(profile.diskSizeGb))
	const [cores, setCores] = useState(profile.cores)
	const [memoryGb, setMemoryGb] = useState(profile.memoryGb)
	// Specs re-seed from the OS profile until the user touches one of them
	const [specsTouched, setSpecsTouched] = useState(false)
	const [usernameInput, setUsernameInput] = useState<string | null>(null)
	const [password, setPassword] = useState('')
	const [passwordVisible, setPasswordVisible] = useState(false)
	const [licenseKey, setLicenseKey] = useState('')
	const [arch, setArch] = useState<'amd64' | 'arm64' | null>(null)
	const [firmware, setFirmware] = useState<'uefi' | 'bios'>('uefi')
	const [diskBus, setDiskBus] = useState<'virtio' | 'sata'>('virtio')
	const [diskDirectory, setDiskDirectory] = useState<string>()
	const [advancedOpen, setAdvancedOpen] = useState(false)
	const [diskBrowserOpen, setDiskBrowserOpen] = useState(false)
	const [isCreating, setIsCreating] = useState(false)
	const diskMinimumErrorId = useId()

	// Seed the specs from the OS profile once the catalog, thread count and host
	// memory have loaded, clamping to what this Umbrel can actually spare
	useEffect(() => {
		if (specsTouched) return
		setDiskSizeInput(String(profile.diskSizeGb))
		setCores(recommendedCores(profile, threads))
		setMemoryGb(maxMemoryGb === undefined ? profile.memoryGb : Math.min(profile.memoryGb, maxMemoryGb))
	}, [profile, threads, maxMemoryGb, specsTouched])

	// Even after the user picks a value, never let it exceed what the host has
	useEffect(() => {
		if (maxMemoryGb !== undefined) setMemoryGb((value) => Math.min(value, maxMemoryGb))
	}, [maxMemoryGb])

	if (isLoading) {
		return (
			<div className='grid min-h-[320px] w-full place-items-center p-12'>
				<Spinner />
			</div>
		)
	}

	// Invalid deep links go back to the catalog. Any real catalog state is valid:
	// create joins an active download or starts/retries one in the background.
	const validOsSource = osImage
	if (!validOsSource && !isoPath) return <Navigate to={MACHINES_PATH} replace />

	const sourceName = osImage
		? osImage.variantName
			? `${osImage.name} ${osImage.variantName}`
			: osImage.name
		: stripDiskImageExtension(isoPath!.split('/').pop() ?? '')
	const customSourceType = isoPath ? (/\.iso$/i.test(isoPath) ? 'installer' : 'disk-image') : undefined
	const sourceVersion =
		osImage?.version ??
		(customSourceType === 'installer'
			? t('machines.custom-installer-iso')
			: customSourceType === 'disk-image'
				? t('machines.custom-disk-image')
				: undefined)
	const sourceOsIconId = osImage && !osImage.custom ? osImage.familyId : 'custom'
	const {color} = getOsVisuals(sourceOsIconId)
	const isCustomSource = !!isoPath || !!osImage?.custom
	const selectedArch = isCustomSource ? (arch ?? capabilities?.hostArchitecture ?? 'amd64') : osImage?.arch
	const softwareEmulated =
		selectedArch !== undefined &&
		(selectedArch !== capabilities?.hostArchitecture ||
			(selectedArch === capabilities?.hostArchitecture && capabilities?.kvmAvailable === false))

	const defaultName = nextAvailableName(
		t('machines.default-vm-name', {os: sourceName}),
		machines.map((machine) => machine.name),
	)
	const nameValue = name ?? defaultName
	const trimmedName = nameValue.trim()

	// The guest account is prefilled with the signed-in Umbrel user's name,
	// squeezed into a shape every guest OS accepts
	const defaultUsername = (userQ.data?.name ?? '')
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '')
		.slice(0, 20)
	const username = usernameInput ?? defaultUsername

	const maxCores = Math.max(1, threads || DEFAULT_CORES)
	const minCores = Math.min(profile.minCores, maxCores)
	const effectiveCores = Math.min(Math.max(cores, minCores), maxCores)
	const effectiveMaxMemoryGb = maxMemoryGb ?? DEFAULT_MEMORY_GB
	// Tiny hosts still get a usable stepper: the floor never exceeds the ceiling
	const minMemoryGb = Math.min(Math.max(MIN_MEMORY_GB, profile.minMemoryGb), effectiveMaxMemoryGb)

	// Validation
	const diskSizeGb = Number(diskSizeInput)
	const diskSizeValid = diskSizeInput !== '' && Number.isInteger(diskSizeGb) && diskSizeGb >= profile.minDiskSizeGb
	const diskBelowMinimum = diskSizeInput !== '' && Number.isInteger(diskSizeGb) && diskSizeGb < profile.minDiskSizeGb
	const diskInvalid = diskSizeInput === '' || diskBelowMinimum
	const nameTaken =
		!isCreating && machines.some((machine) => machine.name.trim().toLowerCase() === trimmedName.toLowerCase())
	const usernameValid =
		username.trim() !== '' && (!requiresWindowsUsername || /^[a-z0-9][a-z0-9_.-]{0,19}$/i.test(username.trim()))
	const licenseKeyValid = !requiresLicenseKey || /^[A-Z0-9]{5}(?:-[A-Z0-9]{5}){4}$/i.test(licenseKey.trim())
	const credentialsValid =
		(!requiresCredentials || (usernameValid && (!requiresPassword || password !== ''))) && licenseKeyValid

	const canCreate = !isCreating && !!trimmedName && !nameTaken && diskSizeValid && credentialsValid

	// Keep the number field usable while typing: digits only, transient empty
	// allowed, capped at the max
	const handleDiskChange = (raw: string) => {
		setSpecsTouched(true)
		const digits = raw.replace(/[^0-9]/g, '')
		if (digits === '') return setDiskSizeInput('')
		setDiskSizeInput(String(Math.min(Number(digits), MAX_DISK_SIZE_GB)))
	}
	const stepDisk = (direction: 1 | -1) => {
		setSpecsTouched(true)
		const current = Number(diskSizeInput) || 0
		// Step by the band we're moving into, so 100 → 95 rather than 100 → 75
		const step = diskStepGb(direction === 1 ? current : current - 1)
		const next = Math.min(MAX_DISK_SIZE_GB, Math.max(profile.minDiskSizeGb, current + direction * step))
		setDiskSizeInput(String(next))
	}

	const handleCreate = async () => {
		if (!canCreate) return
		// The suggestion becomes this machine's name. Pin it so the live machines
		// list (which gains our own machine mid-create) can't bump the title to "2".
		setName(nameValue)
		setIsCreating(true)
		try {
			const machine = await create({
				name: trimmedName,
				...(osImage ? {osId: osImage.id} : {imagePath: isoPath!}),
				diskSizeGb,
				cores: effectiveCores,
				memoryGb,
				arch: selectedArch,
				...(isCustomSource && {
					firmware: selectedArch === 'arm64' ? 'uefi' : firmware,
					diskBus: selectedArch === 'arm64' ? 'virtio' : diskBus,
					...(diskDirectory ? {diskDirectory} : {}),
				}),
				...(requiresCredentials ? {username: username.trim(), ...(requiresPassword ? {password} : {})} : {}),
				...(requiresLicenseKey ? {licenseKey: licenseKey.trim().toUpperCase()} : {}),
			})
			navigate(machinePath(machine.id), {replace: true})
		} catch {
			// Error toast is handled by the mutation
			setIsCreating(false)
		}
	}

	return (
		// No page-level fade: the hero monitor glides in from the catalog card
		// via its shared layoutId, and a fading ancestor would hide it mid-flight.
		// Each section settles on its own beat around the landing instead.
		<div className='flex flex-col gap-8 px-4 py-6 md:p-12'>
			<div className='flex flex-col gap-10 md:flex-row md:gap-10 lg:gap-14'>
				{/* Identity: the machine is the hero, its name editable in place. The
				    column stays lean at md so the spec rows get the width, and
				    stretches back out from lg up. */}
				<div className='flex flex-col items-center gap-4 pt-4 md:w-[200px] md:shrink-0 md:pt-6 lg:w-[280px]'>
					<div className='relative'>
						{/* Glow blooms once the monitor has landed */}
						<motion.div
							aria-hidden
							initial={{opacity: 0}}
							animate={{opacity: 0.5}}
							transition={{delay: 0.25, duration: 0.5, ease: 'easeOut'}}
							className='absolute inset-2 rounded-full blur-3xl'
							style={{backgroundColor: color}}
						/>
						{/* Same layoutId as this OS's catalog card (and intro wall
						    monitor), so the machine you picked travels here as one
						    continuous object. Cold loads just render in place. */}
						<motion.div
							layoutId={`catalog-icon-${sourceOsIconId}`}
							initial={false}
							transition={layoutMorphTransition}
							className='relative'
						>
							<OsIcon osId={sourceOsIconId} className='size-32 lg:size-36' />
						</motion.div>
						{/* The catalog tiles' reflection materializes after landing */}
						<motion.div
							aria-hidden
							initial={{opacity: 0}}
							animate={{opacity: 1}}
							transition={{delay: 0.35, duration: 0.5, ease: 'easeOut'}}
							className='pointer-events-none absolute top-32 left-1/2 h-16 w-32 -translate-x-1/2 lg:top-36 lg:w-36'
						>
							<div className='[mask-image:linear-gradient(to_bottom,black,transparent_75%)] opacity-[0.08] blur-[2px]'>
								<OsIcon osId={sourceOsIconId} className='size-32 -scale-y-100 lg:size-36' />
							</div>
						</motion.div>
					</div>
					{/* Copy settles just after the monitor lands; `relative` also keeps
					    it painting above the reflection */}
					<motion.div
						initial={{opacity: 0, y: 6}}
						animate={{opacity: 1, y: 0}}
						transition={{delay: 0.15, duration: 0.35, ease: 'easeOut'}}
						className='relative flex w-full flex-col items-center gap-4'
					>
						{editingName ? (
							<input
								autoFocus
								value={nameValue}
								onChange={(e) => setName(e.target.value)}
								onBlur={() => setEditingName(false)}
								onKeyDown={(e) => e.key === 'Enter' && setEditingName(false)}
								maxLength={100}
								disabled={isCreating}
								aria-label={t('machines.vm-name')}
								className='w-full bg-transparent text-center text-24 font-semibold -tracking-2 text-white outline-none'
							/>
						) : (
							<button
								onClick={() => setEditingName(true)}
								disabled={isCreating}
								title={t('machines.vm-name')}
								className='group flex max-w-full items-center gap-2 rounded-8 px-2 py-0.5 transition-colors hover:bg-white/5'
							>
								<span className='min-w-0 truncate text-24 font-semibold -tracking-2 text-white'>
									{trimmedName || t('machines.vm-name')}
								</span>
								<Pencil className='size-4 shrink-0 text-white/30 transition-colors group-hover:text-white/60' />
							</button>
						)}
						{nameTaken && (
							<span className='-mt-2 text-12 -tracking-2 text-destructive2-lightest'>{t('machines.name-taken')}</span>
						)}
						<span className='-mt-3 text-13 -tracking-2 text-white/40'>{sourceVersion}</span>
						<span className='mt-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-12 -tracking-2 text-white/50 tabular-nums'>
							{t('machines.cores-count', {count: effectiveCores})} ·{' '}
							{t('machines.gb', {value: fixedMemoryGb ?? memoryGb})} ·{' '}
							{diskSizeValid ? t('machines.gb', {value: diskSizeGb}) : '—'}
						</span>
						{customSourceType && (
							<p className='mt-2 rounded-12 border border-white/10 bg-white/6 p-3 text-12 leading-snug -tracking-2 text-white/55'>
								{customSourceType === 'installer'
									? t('machines.custom-installer-description')
									: t('machines.custom-disk-image-description')}
							</p>
						)}
					</motion.div>
				</div>

				{/* The spec sheet: every decision is one quiet row */}
				<motion.div
					initial={{opacity: 0, y: 6}}
					animate={{opacity: 1, y: 0}}
					transition={{delay: 0.1, duration: 0.35, ease: 'easeOut'}}
					className='min-w-0 flex-1'
				>
					<div className='umbrel-divide-y'>
						<SpecRow
							label={t('machines.configure-processor')}
							note={t('machines.configure-processor-note', {count: maxCores})}
						>
							<Stepper
								display={t('machines.cores-count', {count: effectiveCores})}
								onStep={(direction) => {
									setSpecsTouched(true)
									setCores(Math.min(maxCores, Math.max(minCores, effectiveCores + direction)))
								}}
								canDecrement={effectiveCores > minCores}
								canIncrement={effectiveCores < maxCores}
								decrementLabel={t('machines.decrease-value', {label: t('machines.configure-processor')})}
								incrementLabel={t('machines.increase-value', {label: t('machines.configure-processor')})}
								disabled={isCreating}
							/>
						</SpecRow>
						<SpecRow
							label={t('machines.memory')}
							note={
								fixedMemoryGb
									? t('machines.memory-fixed-for-os', {value: fixedMemoryGb, os: sourceName})
									: t('machines.configure-memory-note', {max: effectiveMaxMemoryGb})
							}
						>
							{fixedMemoryGb ? (
								// Fixed-memory OSs keep the stepper for alignment, just locked
								<Stepper
									display={t('machines.gb', {value: fixedMemoryGb})}
									onStep={() => {}}
									canDecrement={false}
									canIncrement={false}
									decrementLabel={t('machines.decrease-value', {label: t('machines.memory')})}
									incrementLabel={t('machines.increase-value', {label: t('machines.memory')})}
									disabled
								/>
							) : (
								<Stepper
									display={t('machines.gb', {value: memoryGb})}
									onStep={(direction) => {
										setSpecsTouched(true)
										setMemoryGb(Math.min(effectiveMaxMemoryGb, Math.max(minMemoryGb, memoryGb + direction)))
									}}
									canDecrement={memoryGb > minMemoryGb}
									canIncrement={memoryGb < effectiveMaxMemoryGb}
									decrementLabel={t('machines.decrease-value', {label: t('machines.memory')})}
									incrementLabel={t('machines.increase-value', {label: t('machines.memory')})}
									disabled={isCreating || maxMemoryGb === undefined}
								/>
							)}
						</SpecRow>
						<SpecRow label={t('machines.configure-storage')} note={t('machines.configure-storage-note')}>
							<div className='flex flex-col items-end gap-1.5'>
								<Stepper
									middle={
										<div className='relative w-24'>
											{/* The digits-only handler lets us avoid native number-input spinners. */}
											<Input
												type='text'
												inputMode='numeric'
												value={diskSizeInput}
												onValueChange={handleDiskChange}
												disabled={isCreating}
												sizeVariant='short'
												aria-label={t('machines.disk-size')}
												aria-invalid={diskInvalid || undefined}
												aria-describedby={diskInvalid ? diskMinimumErrorId : undefined}
												className='pr-9 text-right text-white tabular-nums'
											/>
											<span className='pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-13 text-white'>
												GB
											</span>
										</div>
									}
									onStep={stepDisk}
									canDecrement={(Number(diskSizeInput) || 0) > profile.minDiskSizeGb}
									canIncrement={(Number(diskSizeInput) || 0) < MAX_DISK_SIZE_GB}
									decrementLabel={t('machines.decrease-value', {label: t('machines.configure-storage')})}
									incrementLabel={t('machines.increase-value', {label: t('machines.configure-storage')})}
									disabled={isCreating}
								/>
								{diskInvalid && (
									<span
										id={diskMinimumErrorId}
										role='alert'
										className='max-w-56 text-right text-12 leading-snug -tracking-2 text-destructive2-lightest'
									>
										{t('machines.disk-minimum', {os: sourceName, value: profile.minDiskSizeGb})}
									</span>
								)}
							</div>
						</SpecRow>
						{requiresCredentials && (
							<SpecRow
								label={t('machines.configure-sign-in')}
								note={manualSetup ? undefined : t('machines.configure-sign-in-note', {os: sourceName})}
							>
								<div className='flex w-42 flex-col gap-2 sm:w-44'>
									<Input
										value={username}
										onValueChange={setUsernameInput}
										placeholder={t('machines.username')}
										disabled={isCreating}
										maxLength={32}
										autoComplete='off'
										sizeVariant='short'
										aria-label={t('machines.username')}
									/>
									{username !== '' && !usernameValid && (
										<span className='px-1 text-12 -tracking-2 text-destructive2-lightest'>
											{t('machines.windows-username-invalid')}
										</span>
									)}
									{requiresPassword && (
										<>
											<div className='relative'>
												<Input
													type={passwordVisible ? 'text' : 'password'}
													value={password}
													onValueChange={setPassword}
													placeholder={t('machines.password')}
													disabled={isCreating}
													maxLength={128}
													autoComplete='new-password'
													sizeVariant='short'
													aria-label={t('machines.password')}
													className='pr-10'
												/>
												<button
													type='button'
													className='absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-white/40 transition-colors hover:bg-white/10 hover:text-white'
													onClick={() => setPasswordVisible((visible) => !visible)}
													aria-label={passwordVisible ? t('machines.password-hide') : t('machines.password-show')}
												>
													{passwordVisible ? <EyeOff className='size-3.5' /> : <Eye className='size-3.5' />}
												</button>
											</div>
											{/* These credentials can't be recovered after creation, so the save-it
											    nudge (same one-time light sweep as onboarding's password note)
											    appears from the first typed character. -mt-2 cancels the column's
											    gap while pt-2 restores it inside, so the reveal grows from zero. */}
											<AnimatePresence initial={false}>
												{password !== '' && (
													<motion.div
														className='-mt-2 overflow-hidden'
														initial={{height: 0, opacity: 0}}
														animate={{height: 'auto', opacity: 1}}
														exit={{height: 0, opacity: 0}}
														transition={{duration: 0.35, ease: [0.16, 1, 0.3, 1]}}
													>
														<p className='px-1 pt-2 text-center text-12 leading-snug font-medium -tracking-2'>
															<FaLock className='mr-1.5 inline-block size-[11px] align-[-0.1em] text-white/40' />
															<span className='animate-text-shine bg-[linear-gradient(90deg,rgba(255,255,255,0.45)_0%,rgba(255,255,255,0.45)_40%,rgba(255,255,255,1)_50%,rgba(255,255,255,0.45)_60%,rgba(255,255,255,0.45)_100%)] bg-[length:300%_100%] bg-clip-text bg-no-repeat text-transparent'>
																{t('machines.configure-sign-in-save-note', {name: trimmedName || sourceName})}
															</span>
														</p>
													</motion.div>
												)}
											</AnimatePresence>
										</>
									)}
								</div>
							</SpecRow>
						)}
						{requiresLicenseKey && (
							<SpecRow label={t('machines.license-key')}>
								<div className='flex w-42 flex-col gap-2 sm:w-44'>
									<Input
										value={licenseKey}
										onValueChange={(value) => setLicenseKey(value.toUpperCase())}
										disabled={isCreating}
										maxLength={29}
										autoComplete='off'
										placeholder='XXXXX-XXXXX-XXXXX-XXXXX-XXXXX'
										sizeVariant='short'
										aria-label={t('machines.license-key')}
									/>
									{licenseKey !== '' && !licenseKeyValid && (
										<span className='px-1 text-12 -tracking-2 text-destructive2-lightest'>
											{t('machines.license-key-invalid')}
										</span>
									)}
								</div>
							</SpecRow>
						)}
						{/* Custom images may target either supported guest architecture */}
						{isCustomSource && (
							<SpecRow label={t('machines.architecture')}>
								<div className='flex flex-col items-end gap-2'>
									<div className='flex gap-2'>
										{(['amd64', 'arm64'] as const).map((option) => (
											<button
												key={option}
												type='button'
												disabled={isCreating}
												onClick={() => setArch(option)}
												className={`h-9 rounded-full border px-4 text-13 font-medium transition-colors ${
													selectedArch === option
														? 'border-brand bg-brand/20 text-white'
														: 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10'
												}`}
											>
												{option === 'amd64' ? 'AMD64' : 'ARM64'}
												{option === capabilities?.hostArchitecture ? ` · ${t('machines.native')}` : ''}
											</button>
										))}
									</div>
									{softwareEmulated && (
										<div className='max-w-[320px] rounded-8 border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-12 leading-snug -tracking-2 text-amber-200/90'>
											{t('machines.software-emulation-warning')}
										</div>
									)}
								</div>
							</SpecRow>
						)}
					</div>

					{isCustomSource && (
						<div className='mt-2 overflow-hidden rounded-15 border border-white/10 bg-white/4'>
							<button
								type='button'
								className='flex h-12 w-full items-center justify-between px-4 text-13 font-medium text-white/70 transition-colors hover:bg-white/5'
								onClick={() => setAdvancedOpen((open) => !open)}
								disabled={isCreating}
							>
								{t('machines.advanced')}
								<ChevronDown className={`size-4 transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
							</button>
							{advancedOpen && (
								<div className='flex flex-col gap-5 border-t border-white/8 p-4'>
									<div className='flex flex-col gap-2'>
										<span className='text-13 text-white/60'>{t('machines.virtual-disk-location')}</span>
										<button
											type='button'
											className='flex h-11 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 text-left text-13 text-white/65 transition-colors hover:bg-white/10'
											onClick={() => setDiskBrowserOpen(true)}
											disabled={isCreating}
										>
											<img src='/assets/dock/dock-files.webp' alt='' className='size-4 rounded-[4px]' />
											<span className='min-w-0 flex-1 truncate'>
												{diskDirectory ?? t('machines.virtual-disk-location-default')}
											</span>
										</button>
										{diskDirectory && (
											<button
												type='button'
												className='self-start px-2 text-11 text-white/40 hover:text-white/65'
												onClick={() => setDiskDirectory(undefined)}
												disabled={isCreating}
											>
												{t('machines.virtual-disk-location-reset')}
											</button>
										)}
										{diskDirectory && (
											<div className='rounded-8 border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-12 leading-snug text-amber-100/80'>
												{t('machines.external-install-warning')}
											</div>
										)}
									</div>

									<div className='flex flex-col gap-2'>
										<span className='text-13 text-white/60'>{t('machines.firmware')}</span>
										<div className='grid grid-cols-2 gap-2'>
											{(['uefi', 'bios'] as const).map((option) => (
												<button
													key={option}
													type='button'
													disabled={isCreating || (selectedArch === 'arm64' && option === 'bios')}
													onClick={() => setFirmware(option)}
													className={`h-10 rounded-full border text-13 font-medium uppercase transition-colors disabled:opacity-35 ${
														(selectedArch === 'arm64' ? 'uefi' : firmware) === option
															? 'border-brand bg-brand/20 text-white'
															: 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10'
													}`}
												>
													{option}
												</button>
											))}
										</div>
									</div>

									<div className='flex flex-col gap-2'>
										<span className='text-13 text-white/60'>{t('machines.disk-compatibility')}</span>
										<div className='grid grid-cols-2 gap-2'>
											{(['virtio', 'sata'] as const).map((option) => (
												<button
													key={option}
													type='button'
													disabled={isCreating || (selectedArch === 'arm64' && option === 'sata')}
													onClick={() => setDiskBus(option)}
													className={`h-10 rounded-full border text-13 font-medium uppercase transition-colors disabled:opacity-35 ${
														(selectedArch === 'arm64' ? 'virtio' : diskBus) === option
															? 'border-brand bg-brand/20 text-white'
															: 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10'
													}`}
												>
													{option}
												</button>
											))}
										</div>
										<p className='text-11 leading-relaxed text-white/35'>
											{t('machines.disk-compatibility-description')}
										</p>
									</div>
								</div>
							)}
							{diskBrowserOpen && (
								<Suspense>
									<MiniBrowser
										open={diskBrowserOpen}
										onOpenChange={setDiskBrowserOpen}
										rootPath='/External'
										rootPaths={['/External', '/Network']}
										preselectOnOpen={false}
										selectionMode='folders'
										selectableFilter={(entry) => {
											if (entry.type !== 'directory') return false
											const segments = entry.path.split('/').filter(Boolean)
											return (
												(segments[0] === 'External' && segments.length >= 2) ||
												(segments[0] === 'Network' && segments.length >= 3)
											)
										}}
										allowNewFolderCreation
										onSelect={setDiskDirectory}
										title={t('machines.virtual-disk-location-select')}
										selectButtonLabel={t('machines.virtual-disk-location-use')}
									/>
								</Suspense>
							)}
						</div>
					)}
				</motion.div>
			</div>

			{/* Footer: reassurance (or the manual-setup caveat) on the left,
			    commitment on the right */}
			<motion.div
				initial={{opacity: 0}}
				animate={{opacity: 1}}
				transition={{delay: 0.2, duration: 0.35, ease: 'easeOut'}}
				className='flex flex-col items-stretch justify-between gap-4 border-t border-white/6 pt-6 sm:flex-row sm:items-center'
			>
				{manualSetup ? (
					<div className='flex max-w-[480px] gap-3 rounded-12 border border-amber-400/20 bg-amber-400/10 p-3 text-left text-amber-100/90'>
						<TriangleAlert className='mt-0.5 size-4 shrink-0' />
						<div className='flex flex-col gap-0.5'>
							<span className='text-13 font-medium'>{t('machines.manual-setup-title')}</span>
							<span className='text-12 leading-snug -tracking-2 text-amber-100/70'>
								{t('machines.manual-setup-description')}
							</span>
						</div>
					</div>
				) : (
					<span className={`text-13 -tracking-2 text-white/35 ${requiresCredentials ? '' : 'invisible max-sm:hidden'}`}>
						{t('machines.configure-installs-itself', {os: sourceName})}
					</span>
				)}
				{/* Stacked with the primary on top below sm (dialog-size buttons are
				    full-width there), a Cancel→Create row from sm up */}
				<div className='flex shrink-0 flex-col-reverse gap-2.5 sm:flex-row sm:items-center'>
					<Button size='dialog' onClick={() => navigate(MACHINES_ADD_PATH)} disabled={isCreating}>
						{t('cancel')}
					</Button>
					<Button variant='primary' size='dialog' onClick={handleCreate} disabled={!canCreate}>
						{isCreating ? t('machines.creating') : t('machines.create-virtual-machine')}
					</Button>
				</div>
			</motion.div>
		</div>
	)
}
