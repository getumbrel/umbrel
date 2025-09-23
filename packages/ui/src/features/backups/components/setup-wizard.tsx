// packages/ui/src/features/backups/setup-wizard.tsx
import {zodResolver} from '@hookform/resolvers/zod'
import {t} from 'i18next'
import {ChevronDown, Copy, Eye, EyeOff, HardDrive, Loader2, LockKeyhole} from 'lucide-react'
import * as React from 'react'
import {useEffect, useMemo, useState} from 'react'
import {FormProvider, useForm, useFormContext, type Resolver, type SubmitHandler} from 'react-hook-form'
import {Trans} from 'react-i18next/TransWithoutContext'
import {FaRegSave} from 'react-icons/fa'
import {TbExternalLink, TbPassword, TbShoppingBag} from 'react-icons/tb'
import {useNavigate} from 'react-router-dom'
import {useCopyToClipboard} from 'react-use'
import {z} from 'zod'

import {ErrorAlert, WarningAlert} from '@/components/ui/alert'
import {ImmersiveDialogSeparator} from '@/components/ui/immersive-dialog'
import umbrelPrivateCloudIcon from '@/features/backups/assets/umbrel-private-cloud-icon.png'
import {BackupDeviceIcon} from '@/features/backups/components/backup-device-icon'
import {BackupsExclusions} from '@/features/backups/components/backups-exclusions'
import {ReviewCard} from '@/features/backups/components/review-card'
import {TabSwitcher} from '@/features/backups/components/tab-switcher'
import {LoadingTile as LoadingCard} from '@/features/backups/components/tiles'
import {useAppsBackupIgnoredSummary} from '@/features/backups/hooks/use-apps-backup-ignore'
import {useBackupIgnoredPaths} from '@/features/backups/hooks/use-backup-ignored-paths'
import {useBackups, type BackupDestination} from '@/features/backups/hooks/use-backups'
import {getLastPathSegment, getRelativePathFromRoot} from '@/features/backups/utils/filepath-helpers'
import {AddManuallyCard, ServerCard} from '@/features/files/components/cards/server-cards'
import AddNetworkShareDialog from '@/features/files/components/dialogs/add-network-share-dialog'
import {MiniBrowser} from '@/features/files/components/mini-browser'
import {useExternalStorage} from '@/features/files/hooks/use-external-storage'
import {useNetworkDeviceType} from '@/features/files/hooks/use-network-device-type'
import {useNetworkStorage} from '@/features/files/hooks/use-network-storage'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {useQueryParams} from '@/hooks/use-query-params'
import {useConfirmation} from '@/providers/confirmation'
import {Button} from '@/shadcn-components/ui/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/shadcn-components/ui/dropdown-menu'
import {Form, FormControl, FormField, FormItem, FormLabel, FormMessage} from '@/shadcn-components/ui/form'
import {Input, PasswordInput} from '@/shadcn-components/ui/input'

// ---------------------------------------------
// Types & Schema
// ---------------------------------------------

const encryptionSchema = z
	.object({
		password: z.string().min(8, {message: t('backups.password-minimum-length')}),
		confirm: z.string(),
	})
	.refine((d) => d.password === d.confirm, {
		message: t('backups.passwords-do-not-match'),
		path: ['confirm'],
	})

const destinationSchema = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('nas'),
		host: z.string().min(1),
		rootPath: z.string().min(1),
	}),
	z.object({
		type: z.literal('external'),
		mountpoint: z.string().min(1),
	}),
]) satisfies z.ZodType<BackupDestination>

const formSchema = z.object({
	destination: destinationSchema,
	folder: z.string().min(1, {message: t('backups.please-choose-folder')}),
	encryption: encryptionSchema,
})

type FormValues = z.infer<typeof formSchema>

// Relaxed schema used during the wizard (destination required, others can be filled later)
const wizardStepSchema = z.object({
	destination: destinationSchema,
	folder: z.string().optional(),
	encryption: encryptionSchema.partial(),
})

// ---------------------------------------------
// Wizard Steps
// ---------------------------------------------

enum Step {
	Destination = 0,
	Folder = 1,
	Exclusions = 2,
	Encryption = 3,
	Review = 4,
}

// Header meta per step (title and optional subtitle)
const headerMetaForStep = (s: Step) => {
	switch (s) {
		case Step.Destination:
			return {
				title: t('backups.select-backup-location'),
				subtitle: t('backups.schedule-description'),
			}
		case Step.Folder:
			return {title: t('backups.select-backup-location'), subtitle: t('backups.select-backup-folder-description')}
		case Step.Exclusions:
			return {title: t('backups.exclude-from-backups'), subtitle: t('backups.exclude-from-backups-description')}
		case Step.Encryption:
			return {title: t('backups.set-encryption-password'), subtitle: t('backups.set-encryption-password-description')}
		case Step.Review:
			return {title: t('backups.review'), subtitle: t('backups.review-description')}
		default:
			return {title: '', subtitle: ''}
	}
}

// ---------------------------------------------
// MAIN COMPONENT
// ---------------------------------------------

export function BackupsSetupWizard() {
	const [step, setStep] = useState<Step>(Step.Destination)
	const navigate = useNavigate()
	const confirm = useConfirmation()

	const form = useForm<FormValues>({
		resolver: zodResolver(wizardStepSchema as any) as Resolver<FormValues>,
		defaultValues: {
			destination: undefined as any,
			folder: '',
			encryption: {password: '', confirm: ''},
		},
		mode: 'onChange',
	})

	const {setupBackup, isSettingUpBackup, repositories} = useBackups()
	const {disks} = useExternalStorage()
	const showExclusionsStep = (repositories?.length ?? 0) === 0

	// Watches so the parent re-renders when these fields change
	const destination = form.watch('destination')
	const folder = form.watch('folder')
	const enc = form.watch('encryption')

	const canNext =
		step === Step.Destination
			? !!destination
			: step === Step.Folder
				? !!folder
				: step === Step.Encryption
					? (enc?.password?.length ?? 0) >= 8 && enc?.password === enc?.confirm
					: true

	// Validate per-step before advancing
	const next = async () => {
		const fieldsByStep: Record<Step, Array<keyof FormValues | string>> = {
			[Step.Destination]: ['destination'],
			[Step.Folder]: ['folder'],
			[Step.Exclusions]: [],
			[Step.Encryption]: ['encryption.password', 'encryption.confirm'],
			[Step.Review]: [],
		}
		const fields = fieldsByStep[step] ?? []
		const ok = await form.trigger(fields as any, {shouldFocus: true})
		if (!ok) return

		// Before advancing from Encryption, show a confirmation alert
		if (step === Step.Encryption) {
			try {
				const res = await confirm({
					title: t('backups.store-encryption-password-safely'),
					message: t('backups.encryption-password-warning'),
					actions: [
						{label: t('backups.i-understand'), value: 'confirm', variant: 'primary'},
						{label: t('cancel'), value: 'cancel', variant: 'default'},
					],
				})
				if (res.actionValue !== 'confirm') return
			} catch {
				// dialog dismissed or cancelled
				return
			}
		}
		setStep((s) => {
			let target = Math.min(s + 1, Step.Review)
			if (!showExclusionsStep && s === Step.Folder) target = Step.Encryption
			return target
		})
	}

	const back = () =>
		setStep((s) => {
			let target = Math.max(s - 1, Step.Destination)
			if (!showExclusionsStep && s === Step.Encryption) target = Step.Folder
			return target
		})

	// When destination changes, reset dependent fields (folder/encryption/frequency) using reset
	const handleDestinationChange = (dest: BackupDestination) => {
		form.reset(
			{
				destination: dest,
				folder: '',
				encryption: {password: '', confirm: ''},
			},
			{
				keepDirty: false,
				keepTouched: false,
				keepErrors: false,
			},
		)
	}

	// Full submit (strict validate)
	const onSubmit: SubmitHandler<FormValues> = async (values) => {
		const parsed = formSchema.safeParse(values)
		if (!parsed.success) return

		try {
			await setupBackup({
				destination: parsed.data.destination,
				folder: parsed.data.folder,
				encryptionPassword: parsed.data.encryption.password,
			})
			// On success, close the dialog by navigating to Configure
			navigate('/settings/backups/configure', {preventScrollReset: true})
		} catch {
			// Error toasts are handled in the hook; remain on this step
		}
	}

	const folderRootPath = React.useMemo(() => {
		if (!destination) return undefined
		return destination.type === 'nas' ? destination.rootPath : destination.mountpoint
	}, [destination])

	// Clear sensitive encryption fields on unmount (defense-in-depth)
	React.useEffect(() => {
		return () => {
			form.reset({
				...form.getValues(),
				encryption: {password: '', confirm: ''},
			})
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

	return (
		<FormProvider {...form}>
			<div className='flex h-full flex-col'>
				{/* Header */}
				<div className='mb-4'>
					{(() => {
						const h = headerMetaForStep(step)
						return (
							<>
								<h2 className='text-24 font-medium text-white'>{h.title}</h2>
								{h.subtitle ? <span className='text-13 text-white/60'>{h.subtitle}</span> : null}
							</>
						)
					})()}
				</div>
				<div className='pb-4'>
					<ImmersiveDialogSeparator />
				</div>

				{/* Body */}
				<div className='min-h-0 flex-1 overflow-y-auto'>
					{step === Step.Destination && <DestinationStep onChangeDestination={handleDestinationChange} />}
					{step === Step.Folder && folderRootPath && (
						<FolderPickerStep
							rootPath={folderRootPath}
							disabledPaths={destination?.type === 'nas' ? [folderRootPath] : []}
							value={folder}
							onChange={(val) => form.setValue('folder', val, {shouldValidate: true})}
							selectedName={
								destination?.type === 'nas'
									? destination.host
									: destination?.type === 'external'
										? disks
												?.flatMap((disk) =>
													disk.partitions.map((p) => ({
														mountpoint: p.mountpoints?.[0],
														label: p.label || disk.name || t('external-drive'),
													})),
												)
												.find((p) => p.mountpoint === destination.mountpoint)?.label
										: t('external-drive')
							}
						/>
					)}
					{step === Step.Exclusions && showExclusionsStep && <BackupsExclusions />}
					{step === Step.Encryption && <EncryptionStep />}
					{step === Step.Review && <ReviewStep values={form.getValues()} />}
				</div>

				{/* Footer */}
				<div className='mt-6 flex items-center gap-2 pt-4 max-md:flex-col-reverse'>
					{step !== Step.Destination ? (
						<Button size='dialog' onClick={back} className='min-w-0 max-md:w-full'>
							{t('back')}
						</Button>
					) : null}
					{step !== Step.Review ? (
						<>
							<Button
								variant='primary'
								size='dialog'
								onClick={next}
								disabled={!canNext}
								className='min-w-0 max-md:w-full'
							>
								{t('continue')}
							</Button>
						</>
					) : (
						<Button
							variant='primary'
							size='dialog'
							disabled={isSettingUpBackup}
							onClick={form.handleSubmit(onSubmit)}
							className='min-w-0 max-md:w-full'
						>
							{isSettingUpBackup ? <Loader2 className='h-4 w-4 animate-spin' /> : t('backups-setup-confirm')}
						</Button>
					)}
				</div>
			</div>
		</FormProvider>
	)
}

// ---------------------------------------------
// Step 0 — Destination (NAS or External Drive)
// ---------------------------------------------

function DestinationStep({onChangeDestination}: {onChangeDestination: (dest: BackupDestination) => void}) {
	const form = useFormContext<FormValues>()
	const {params, addLinkSearchParams} = useQueryParams()
	const initialTabParam = params.get('backups-setup-tab')
	const isMobile = useIsMobile()
	const navigate = useNavigate()

	const [tab, setTab] = useState<'nas' | 'external' | 'umbrel-private-cloud'>(
		initialTabParam === 'external'
			? 'external'
			: initialTabParam === 'umbrel-private-cloud'
				? 'umbrel-private-cloud'
				: 'nas',
	)
	const [isAddNasOpen, setAddNasOpen] = useState(false)

	// Prefer the selected destination type to drive the tab (so Back returns to the right tab)
	const dest = form.watch('destination') as BackupDestination | undefined
	useEffect(() => {
		if (dest?.type === 'nas' || dest?.type === 'external') {
			setTab(dest.type)
		}
	}, [dest?.type])

	// NAS sources: show hosts that have at least one mounted share
	const {shares, isLoadingShares, refetchShares} = useNetworkStorage({suppressNavigateOnAdd: true})
	const hosts = useMemo(() => {
		if (!shares) return []
		const mounted = shares.filter((s) => s.isMounted)
		return Array.from(new Set(mounted.map((s) => s.host)))
	}, [shares])

	// External drives (partitions)
	const {disks, isLoadingExternalStorage} = useExternalStorage()

	const currentDest = form.watch('destination')

	const switchTab = (tab: 'nas' | 'external' | 'umbrel-private-cloud') => {
		setTab(tab)
		const search = addLinkSearchParams({'backups-setup-tab': tab})
		// Update URL without navigating
		window.history.replaceState(null, '', search)
	}

	return (
		<div className='space-y-4'>
			{isMobile ? (
				<div className='flex items-center justify-between pb-4'>
					<span className='text-13'>{t('backups.backup-location')}</span>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant='default' className='flex items-center gap-2'>
								<span>
									{tab === 'nas'
										? t('backups-setup-umbrel-or-nas')
										: tab === 'external'
											? t('external-drive')
											: t('backups-setup-umbrel-private-cloud')}
								</span>
								<ChevronDown className='h-3 w-3' />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align='end' className='min-w-[280px]'>
							<DropdownMenuItem onSelect={() => switchTab('nas')}>
								<div className='flex flex-col'>
									<div className='text-14 font-medium'>{t('backups-setup-umbrel-or-nas')}</div>
									<div className='text-12 text-white/40'>{t('backups-setup-nas-or-umbrel-description')}</div>
								</div>
							</DropdownMenuItem>
							<DropdownMenuItem onSelect={() => switchTab('external')}>
								<div className='flex flex-col'>
									<div className='text-14 font-medium'>{t('external-drive')}</div>
									<div className='text-12 text-white/40'>{t('backups-setup-external-description')}</div>
								</div>
							</DropdownMenuItem>
							<DropdownMenuItem onSelect={() => switchTab('umbrel-private-cloud')}>
								<div className='flex flex-col'>
									<div className='text-14 font-medium'>{t('backups-setup-umbrel-private-cloud')}</div>
									<div className='text-12 text-white/40'>{t('backups-setup-umbrel-private-cloud-description')}</div>
								</div>
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			) : (
				<TabSwitcher
					options={[
						{id: 'nas', label: t('backups-setup-umbrel-or-nas')},
						{id: 'external', label: t('external-drive')},
						{id: 'umbrel-private-cloud', label: t('backups-setup-umbrel-private-cloud')},
					]}
					value={tab}
					onChange={(v) => {
						switchTab(v as 'nas' | 'external' | 'umbrel-private-cloud')
					}}
				/>
			)}

			{tab === 'nas' ? (
				<div className='grid grid-cols-[repeat(auto-fill,125px)] gap-3'>
					{isLoadingShares ? (
						<LoadingCard />
					) : hosts.length === 0 ? (
						<AddManuallyCard onClick={() => setAddNasOpen(true)} label={t('backups.add-umbrel-or-nas')} />
					) : (
						[
							<AddManuallyCard
								key='add-umbrel-or-nas'
								onClick={() => setAddNasOpen(true)}
								label={t('backups.add-umbrel-or-nas')}
							/>,
							...hosts.map((host) => {
								const selected =
									currentDest?.type === 'nas' &&
									currentDest.host === host &&
									currentDest.rootPath === `/Network/${host}`
								return (
									<ServerCard
										key={host}
										selected={!!selected}
										onClick={() => onChangeDestination({type: 'nas', host, rootPath: `/Network/${host}`})}
									>
										<BackupDeviceIcon path={`/Network/${host}`} className='mb-2 size-12 opacity-90' />
										<span className='w-full truncate text-center text-[12px]' title={host}>
											{host}
										</span>
									</ServerCard>
								)
							}),
						]
					)}
				</div>
			) : tab === 'external' ? (
				<div className='grid grid-cols-[repeat(auto-fill,125px)] gap-3'>
					{isLoadingExternalStorage ? (
						<div className='col-span-full flex items-center justify-start gap-2 py-2 text-sm text-white/60'>
							<Loader2 className='size-4 animate-spin will-change-transform' />
							<span>{t('backups.scanning-for-external-drives')}</span>
						</div>
					) : !disks || disks.length === 0 ? (
						<div className='col-span-full flex items-center justify-start py-2'>
							<span className='text-sm text-white/40'>{t('backups.no-external-drives-detected')}</span>
						</div>
					) : (
						disks.flatMap((disk) =>
							disk.partitions.flatMap((p) => {
								const firstMount = p.mountpoints?.[0]
								if (!firstMount) return []
								const label = p.label || disk.name || t('unknown')
								const selected = currentDest?.type === 'external' && currentDest.mountpoint === firstMount
								return [
									<ServerCard
										key={`${disk.id}-${p.id}-${firstMount}`}
										selected={!!selected}
										onClick={() => onChangeDestination({type: 'external', mountpoint: firstMount})}
									>
										<div className='mb-2 flex h-12 w-12 items-center justify-center'>
											<BackupDeviceIcon path={firstMount} className='size-8 opacity-80' />
										</div>
										<div className='truncate text-center text-[12px]'>{label}</div>
									</ServerCard>,
								]
							}),
						)
					)}
				</div>
			) : tab === 'umbrel-private-cloud' ? (
				<div className='flex flex-col items-center justify-center gap-7 rounded-20 border border border-white/10 bg-black/30 pb-10 pt-8'>
					<div className='flex flex-col items-center justify-center gap-1'>
						<h2 className='mb-0 text-2xl text-white'>{t('backups-setup-umbrel-private-cloud')}</h2>
						<span className='mt-0  text-sm text-white/80'>{t('backups-setup-umbrel-private-cloud-subtitle')}</span>
					</div>
					<img
						src={umbrelPrivateCloudIcon}
						alt={t('backups-setup-umbrel-private-cloud')}
						className='w-24'
						draggable={false}
					/>
					<div className='flex flex-col items-center justify-center gap-2'>
						<p className='max-w-md text-center text-sm text-white/80'>
							<Trans
								i18nKey='backups-setup-umbrel-private-cloud-cta'
								components={{
									bold: <span className='font-bold text-white' />,
								}}
							/>
						</p>
						<Button asChild className='mt-4 px-4' variant='primary'>
							<a href='https://link.umbrel.com/private-cloud' target='_blank' rel='noopener noreferrer'>
								<TbExternalLink className='size-4' />
								{t('backups-setup-umbrel-private-cloud-cta-link')}
							</a>
						</Button>
					</div>
				</div>
			) : null}

			<AddNetworkShareDialog
				open={isAddNasOpen}
				onOpenChange={(v) => setAddNasOpen(v)}
				suppressNavigateOnAdd
				onAdded={() => {
					refetchShares()
				}}
			/>
		</div>
	)
}

// ---------------------------------------------
// Step 1 — Folder Picker (read-only input + mini browser)
// ---------------------------------------------

function FolderPickerStep({
	rootPath,
	value,
	onChange,
	selectedName,
	disabledPaths = [],
}: {
	rootPath: string
	value?: string
	onChange: (v: string) => void
	selectedName?: string
	disabledPaths?: string[]
}) {
	const [isBrowserOpen, setBrowserOpen] = useState(false)

	// Show nothing until a subfolder is chosen
	const displayValue = value || ''
	const shownValue = React.useMemo(() => {
		if (!displayValue) return ''
		return getRelativePathFromRoot(displayValue, rootPath)
	}, [displayValue, rootPath])

	return (
		<div className='space-y-4'>
			<div>
				<div className='mb-4 text-sm font-medium'>
					{/* Use Trans component to allow HTML interpolation for brand styling while maintaining proper i18n sentence context */}
					<Trans
						i18nKey='backups.choose-folder-within-device'
						values={{device: selectedName || ''}}
						components={{
							bold: <span className='font-bold text-brand-lightest' />,
						}}
					/>
				</div>

				{/* Input with inline "Browse" button */}
				<div className='relative'>
					<Input
						type='text'
						value={shownValue}
						readOnly
						className='cursor-pointer select-none pr-28 text-white/90'
						title={shownValue}
						onClick={() => setBrowserOpen(true)}
					/>
					<Button
						type='button'
						size='sm'
						className='absolute right-5 top-1/2 -translate-y-1/2'
						onClick={() => setBrowserOpen(true)}
					>
						{t('backups.browse')}
					</Button>
				</div>

				<div className='mt-4'>
					<WarningAlert
						icon={HardDrive}
						description={t('backups.storage-capacity-warning', {device: selectedName || ''})}
					/>
				</div>
			</div>

			{/* Mini folder browser */}
			<MiniBrowser
				open={isBrowserOpen}
				onOpenChange={setBrowserOpen}
				rootPath={rootPath}
				disabledPaths={disabledPaths}
				onOpenPath={value || rootPath}
				preselectOnOpen={true}
				selectionMode='folders'
				title={t('backups.select-backup-folder')}
				onSelect={(p) => {
					onChange(p)
					setBrowserOpen(false)
				}}
			/>
		</div>
	)
}

// ---------------------------------------------
// Step 3 — Encryption (index 3)
// ---------------------------------------------

function EncryptionStep() {
	const form = useFormContext<FormValues>()

	return (
		<div className='space-y-4'>
			<Form {...form}>
				<div className='grid grid-cols-1 gap-3'>
					<FormField
						control={form.control}
						name='encryption.password'
						render={({field}) => (
							<FormItem>
								<FormLabel className='text-13 opacity-60'>{t('password')}</FormLabel>
								<FormControl>
									<PasswordInput value={field.value} onValueChange={field.onChange} />
								</FormControl>
								<div className='relative'>
									<FormMessage className='absolute -top-1 left-0 text-xs' />
								</div>
							</FormItem>
						)}
					/>

					<FormField
						control={form.control}
						name='encryption.confirm'
						render={({field}) => (
							<FormItem>
								<FormLabel className='text-13 opacity-60'>{t('backups.confirm-password')}</FormLabel>
								<FormControl>
									<PasswordInput value={field.value} onValueChange={field.onChange} />
								</FormControl>
								<div className='relative'>
									<FormMessage className='absolute -top-1 left-0 text-xs' />
								</div>
							</FormItem>
						)}
					/>
				</div>
			</Form>

			<ErrorAlert icon={LockKeyhole} description={t('backups.password-safety-warning')} />
		</div>
	)
}

// ---------------------------------------------
// Step 4 — Review (index 4)
// ---------------------------------------------

function ReviewStep({values}: {values: FormValues}) {
	let pathOnly = values.folder
	if (values.destination.type === 'nas') {
		const hostRoot = `/Network/${values.destination.host}`
		if (pathOnly.startsWith(hostRoot)) {
			pathOnly = pathOnly.slice(hostRoot.length) || '/'
			if (!pathOnly.startsWith('/')) pathOnly = `/${pathOnly}`
		}
	} else {
		const mountRoot = values.destination.mountpoint
		if (mountRoot && pathOnly.startsWith(mountRoot)) {
			pathOnly = pathOnly.slice(mountRoot.length) || '/'
			if (!pathOnly.startsWith('/')) pathOnly = `/${pathOnly}`
		}
	}

	let locationCombined: string
	const {deviceType} = useNetworkDeviceType(values.destination.type === 'nas' ? values.destination.rootPath : '')
	if (values.destination.type === 'nas') {
		locationCombined = `${deviceType === 'umbrel' ? t('umbrel') : t('nas')} · ${values.destination.host} · ${pathOnly}`
	} else {
		locationCombined = `${t('external-drive')} · ${getLastPathSegment(values.destination.mountpoint)} · ${pathOnly}`
	}

	const [showPw, setShowPw] = useState(false)
	const plainPw = values.encryption.password
	const masked = plainPw ? '•'.repeat(Math.max(8, plainPw.length)) : ''
	const [, copyToClipboard] = useCopyToClipboard()

	const {filteredIgnoredPaths} = useBackupIgnoredPaths()
	const {excludedAppsCount} = useAppsBackupIgnoredSummary()

	return (
		<div className='space-y-3'>
			<ReviewCard icon={<FaRegSave className='h-5 w-5 opacity-80' />} label={t('backups.location')}>
				<div className='break-words text-sm' title={locationCombined}>
					{locationCombined}
				</div>
			</ReviewCard>

			<ReviewCard icon={<TbShoppingBag className='h-5 w-5 opacity-80' />} label={t('backups.apps-and-data')}>
				<div className='text-sm'>
					{filteredIgnoredPaths.length > 0 || excludedAppsCount > 0
						? [
								filteredIgnoredPaths.length > 0
									? t('{{count}} {{fileFolderText}} excluded', {
											count: filteredIgnoredPaths.length,
											fileFolderText: filteredIgnoredPaths.length === 1 ? t('file/folder') : t('files/folders'),
										})
									: null,
								excludedAppsCount > 0
									? t('{{count}} {{appText}} excluded', {
											count: excludedAppsCount,
											appText: excludedAppsCount === 1 ? t('app') : t('apps'),
										})
									: null,
							]
								.filter(Boolean)
								.join(' · ')
						: t('backups.all-apps-and-data-will-be-backed-up')}
				</div>
			</ReviewCard>

			<ReviewCard icon={<TbPassword className='h-5 w-5 opacity-80' />} label={t('backups.encryption')}>
				<div className='flex items-center gap-2 text-sm'>
					{plainPw ? (
						<>
							<span className='opacity-90'>{t('backups.password-is-set')}</span>
							{/* Constrained, selectable password display */}
							<Input
								readOnly
								value={showPw ? plainPw : masked}
								size={Math.min((showPw ? plainPw : masked).length, 32)}
								type={showPw ? 'text' : 'text'}
								className='flex h-6 w-auto max-w-[120px] items-center overflow-hidden text-ellipsis whitespace-nowrap rounded-[3px] border border-[#ffffff0a] bg-white/10 px-1 font-mono text-12 leading-none outline-none'
							/>
							<span
								className='group inline-flex h-6 w-6 cursor-pointer items-center justify-center'
								onClick={() => setShowPw((s) => !s)}
								title={showPw ? t('backups.hide') : t('backups.show')}
							>
								{showPw ? (
									<EyeOff className='h-4 w-4 opacity-80 transition-colors group-hover:opacity-100' />
								) : (
									<Eye className='h-4 w-4 opacity-80 transition-colors group-hover:opacity-100' />
								)}
							</span>
							<span
								className='group inline-flex h-6 w-6 cursor-pointer items-center justify-center'
								onClick={() => copyToClipboard(plainPw)}
								title={t('backups.copy')}
							>
								<Copy className='h-4 w-4 opacity-80 transition-colors group-hover:opacity-100' />
							</span>
						</>
					) : (
						<span className='opacity-60'>{t('backups.no-password-set')}</span>
					)}
				</div>
			</ReviewCard>
		</div>
	)
}
