import {zodResolver} from '@hookform/resolvers/zod'
import {AnimatePresence, motion} from 'framer-motion'
import {Loader, Loader2, RotateCcw} from 'lucide-react'
import {startTransition, useEffect, useState} from 'react'
import {useForm, useFormContext} from 'react-hook-form'
import {z} from 'zod'

import {BackupDeviceIcon} from '@/features/backups/components/backup-device-icon'
import {AddManuallyCard, ServerCard} from '@/features/files/components/cards/server-cards'
import {useNetworkStorage} from '@/features/files/hooks/use-network-storage'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {Button} from '@/shadcn-components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/shadcn-components/ui/dialog'
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerHeader,
	DrawerScroller,
	DrawerTitle,
} from '@/shadcn-components/ui/drawer'
import {Form, FormControl, FormField, FormItem, FormLabel, FormMessage} from '@/shadcn-components/ui/form'
import {Input, PasswordInput} from '@/shadcn-components/ui/input'
import {RadioGroup, RadioGroupItem} from '@/shadcn-components/ui/radio-group'
import {useDialogOpenProps} from '@/utils/dialog'
import {t} from '@/utils/i18n'

// Validation schemas
// Step‑agnostic schema where `share` is optional so early steps validate.
// TODO: update zod messages
const stepSchema = z.object({
	host: z.string().min(1, {message: t('files-add-network-share.host-required')}),
	share: z.string().optional(),
	username: z.string().min(1, {message: t('files-add-network-share.username-required')}),
	password: z.string().min(1, {message: t('files-add-network-share.password-required')}),
})

// Final submission schema where `share` must be present.
const submitSchema = stepSchema.extend({
	share: z.string().min(1, {message: t('files-add-network-share.share-required')}),
})

// Form steps
enum Step {
	Discover = 0,
	Credentials = 1,
	SelectShare = 2,
}

/* ------------------------------------------------------------------ */
/* MAIN COMPONENT                                                     */
/* ------------------------------------------------------------------ */
export default function AddNetworkShareDialog(props?: {
	// These optional props allow us to control this dialog from the backup/restore wizards.
	open?: boolean
	onOpenChange?: (open: boolean) => void
	suppressNavigateOnAdd?: boolean
	onAdded?: () => void
}) {
	const internalDialog = useDialogOpenProps('files-add-network-share')
	const dialogProps = {
		open: props?.open ?? internalDialog.open,
		onOpenChange: props?.onOpenChange ?? internalDialog.onOpenChange,
	}
	const isMobile = useIsMobile()

	// wizard vs manual entry
	const [mode, setMode] = useState<'wizard' | 'manual'>('wizard')
	const [step, setStep] = useState<Step>(Step.Discover)

	const form = useForm({
		resolver: zodResolver(stepSchema),
		defaultValues: {host: '', share: '', username: '', password: ''},
		mode: 'onChange',
	})
	const {host, share, username, password} = form.watch()

	// main network storage hook
	const {
		discoverServers,
		discoveredServers: servers,
		isDiscoveringServers: isLoadingServers,
		addShare,
		isAddingShare,
		discoverSharesOnServer,
	} = useNetworkStorage({suppressNavigateOnAdd: props?.suppressNavigateOnAdd})

	// Share discovery (imperative) so we let the hook show error toast
	// and we just handle steps here (e.g. go back to credentials if discovery fails)
	const [shares, setShares] = useState<string[]>([])
	const [isLoadingShares, setIsLoadingShares] = useState(false)

	// fetch shares whenever we enter SelectShare
	useEffect(() => {
		let abort = false
		const fetchShares = async () => {
			if (step !== Step.SelectShare || !host || !username || !password) return
			setIsLoadingShares(true)
			try {
				const s = await discoverSharesOnServer(host, username, password)
				if (!abort)
					// Render the resulting shares as a non‑urgent update to keep the spinner animation smooth
					startTransition(() => {
						setShares(s)
					})
			} catch {
				if (!abort) setStep(Step.Credentials) // toast already handled inside hook
			} finally {
				if (!abort) setIsLoadingShares(false)
			}
		}
		fetchShares()
		return () => {
			abort = true
		}
	}, [step, host, username, password])

	// form handlers
	const resetAll = () => {
		setMode('wizard')
		setStep(Step.Discover)
		form.reset()
		discoverServers()
	}

	useEffect(() => {
		if (dialogProps.open) resetAll()
	}, [dialogProps.open])

	const next = () => {
		form.clearErrors()
		setStep((s) => Math.min(s + 1, Step.SelectShare))
	}

	const back = () => {
		form.clearErrors()
		setStep((s) => Math.max(s - 1, Step.Discover))
	}

	const handleSubmit = async () => {
		// Validate with the final schema before submitting
		const parsed = submitSchema.safeParse(form.getValues())
		if (!parsed.success) return

		try {
			await addShare(parsed.data)
			props?.onAdded?.()
			dialogProps.onOpenChange(false)
		} catch {
			// the network storage hook handles toast
		}
	}

	// footer buttons
	let footer: React.ReactNode = null

	if (mode === 'wizard') {
		switch (step) {
			// Discover step
			case Step.Discover:
				footer = (
					<DialogFooter className={`${isMobile ? 'flex flex-col items-stretch' : 'flex items-center'} gap-2 pt-4`}>
						<Button variant='primary' size='dialog' disabled={!host} onClick={next}>
							{t('files-add-network-share.continue')}
						</Button>
					</DialogFooter>
				)
				break

			// Credentials step
			case Step.Credentials:
				footer = (
					<DialogFooter className='gap-2 pt-4'>
						<Button size='dialog' onClick={back}>
							{t('files-add-network-share.back')}
						</Button>
						<Button variant='primary' size='dialog' disabled={!(host && username && password)} onClick={next}>
							{t('files-add-network-share.continue')}
						</Button>
					</DialogFooter>
				)
				break

			// Select share step
			case Step.SelectShare:
				footer = (
					<DialogFooter className='gap-2 pt-4'>
						<Button size='dialog' onClick={back}>
							{t('files-add-network-share.back')}
						</Button>
						<Button variant='primary' size='dialog' disabled={!share || isAddingShare} onClick={handleSubmit}>
							{isAddingShare ? <Loader2 className='h-4 w-4 animate-spin' /> : t('files-add-network-share.add-share')}
						</Button>
					</DialogFooter>
				)
				break
		}
	} else {
		// Manual mode footer
		const manualValid = submitSchema.safeParse(form.getValues()).success
		footer = (
			<DialogFooter className={`gap-2 pt-4 ${isMobile ? 'flex-col-reverse' : ''}`}>
				<Button size='dialog' onClick={() => setMode('wizard')}>
					{t('files-add-network-share.back')}
				</Button>
				<Button variant='primary' size='dialog' disabled={isAddingShare || !manualValid} onClick={handleSubmit}>
					{isAddingShare ? <Loader2 className='h-4 w-4 animate-spin' /> : t('files-add-network-share.add-share')}
				</Button>
			</DialogFooter>
		)
	}

	const header = (
		<>
			{isMobile ? (
				<DrawerHeader>
					<DrawerTitle>{t('files-add-network-share.title')}</DrawerTitle>
					<DrawerDescription>{t('files-add-network-share.description')}</DrawerDescription>
				</DrawerHeader>
			) : (
				<DialogHeader>
					<DialogTitle>{t('files-add-network-share.title')}</DialogTitle>
					{/* TODO: consider adding a note to the description that mentions backups and a link to the relevant Settings element */}
					<DialogDescription>{t('files-add-network-share.description')}</DialogDescription>
				</DialogHeader>
			)}
		</>
	)

	const body = (
		<div className='flex-1 overflow-y-auto overflow-x-hidden'>
			<AnimatePresence mode='wait'>
				{mode === 'wizard' ? (
					<Form {...form}>
						{/* Discover */}
						{step === Step.Discover && (
							<DiscoverStep
								servers={servers}
								isLoading={isLoadingServers}
								selectedHost={host}
								onSelectServer={(h) => form.setValue('host', h)}
								onRetry={discoverServers}
								onManual={() => {
									setMode('manual')
									form.clearErrors()
								}}
							/>
						)}

						{/* Credentials */}
						{step === Step.Credentials && (
							<motion.div key='creds' initial={{opacity: 0}} animate={{opacity: 1}} transition={{duration: 0.2}}>
								<CredentialsStep />
							</motion.div>
						)}

						{/* Select share */}
						{step === Step.SelectShare && (
							<motion.div key='shares' initial={{opacity: 0}} animate={{opacity: 1}} transition={{duration: 0.2}}>
								<SelectShareStep
									shares={shares}
									isLoading={isLoadingShares}
									selectedShare={share}
									onSelect={(s) => form.setValue('share', s)}
									disabled={isAddingShare}
								/>
							</motion.div>
						)}
					</Form>
				) : (
					/* Manual mode */
					<motion.div key='manual' initial={{opacity: 0}} animate={{opacity: 1}} transition={{duration: 0.2}}>
						<div className='space-y-4 py-2'>
							<p className='text-sm font-medium'>{t('files-add-network-share.enter-details-manually')}</p>

							<Form {...form}>
								<div className='space-y-4'>
									{(['host', 'share', 'username', 'password'] as const).map((field) => {
										const placeholders = {
											host: '192.168.1.100',
											share: t('files-add-network-share.share-placeholder'),
											username: t('files-add-network-share.username-placeholder'),
											password: '',
										}

										const labels = {
											host: t('files-add-network-share.host-label'),
											share: t('files-add-network-share.share-label'),
											username: t('files-add-network-share.username-label'),
											password: t('files-add-network-share.password-label'),
										}

										return (
											<FormField
												key={field}
												control={form.control}
												name={field}
												render={({field: f}) => (
													<FormItem>
														<FormLabel className='text-13 text-white/60'>{labels[field]}</FormLabel>
														<FormControl>
															{field === 'password' ? (
																<PasswordInput value={f.value} onValueChange={f.onChange} />
															) : (
																<Input type='text' placeholder={placeholders[field]} {...f} />
															)}
														</FormControl>
														<div className='relative'>
															<FormMessage className='absolute -top-1 left-0 text-xs' />
														</div>
													</FormItem>
												)}
											/>
										)
									})}
								</div>
							</Form>
						</div>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	)

	if (isMobile) {
		return (
			<Drawer open={dialogProps.open} onOpenChange={dialogProps.onOpenChange}>
				<DrawerContent fullHeight>
					{header}
					<DrawerScroller>{body}</DrawerScroller>
					{footer}
				</DrawerContent>
			</Drawer>
		)
	}

	return (
		<Dialog {...dialogProps}>
			<DialogContent className='flex min-h-[480px] flex-col'>
				{header}
				{body}
				{footer}
			</DialogContent>
		</Dialog>
	)
}

/* ------------------------------------------------------------------ */
/* Step components (without footer)                                   */
/* ------------------------------------------------------------------ */
function DiscoverStep({
	servers,
	isLoading,
	selectedHost,
	onSelectServer,
	onManual,
	onRetry,
}: {
	servers?: string[]
	isLoading: boolean
	selectedHost: string
	onSelectServer: (h: string) => void
	onManual: () => void
	onRetry: () => void
}) {
	return (
		<div className='grid grid-cols-[repeat(auto-fill,minmax(125px,1fr))] gap-4 py-2'>
			<AddManuallyCard onClick={onManual} label={t('files-add-network-share.add-manually')} />

			{isLoading ? (
				<ServerCard>
					<div className='mb-2 flex size-12 items-center justify-center'>
						<Loader className='size-8 animate-spin text-white/60' />
					</div>
					<span className='text-[12px] text-white/60'>{t('files-add-network-share.discovering')}</span>
				</ServerCard>
			) : (servers?.length ?? 0) === 0 ? (
				<ServerCard onClick={isLoading ? undefined : onRetry}>
					<div className='mb-2 flex size-12 items-center justify-center'>
						<div className='flex size-12 items-center justify-center rounded-full bg-white/10'>
							<div className='flex size-8 items-center justify-center rounded-full bg-white/20'>
								{isLoading ? (
									<Loader2 className='size-4 animate-spin text-white/60' />
								) : (
									<RotateCcw className='size-4' />
								)}
							</div>
						</div>
					</div>
					<span
						className='w-full truncate text-center text-[12px] text-white/60'
						title={t('files-add-network-share.retry-discovery')}
					>
						{t('files-add-network-share.retry-discovery')}
					</span>
				</ServerCard>
			) : (
				servers!.map((h, index) => (
					<motion.div
						key={h}
						initial={{opacity: 0}}
						animate={{opacity: 1}}
						transition={{duration: 0.3, delay: index * 0.1}}
					>
						<ServerCard selected={selectedHost === h} onClick={() => onSelectServer(h)}>
							<BackupDeviceIcon path={`/Network/${h}`} className='mb-2 size-12' />
							<span className='w-full truncate text-center text-[12px]' title={h}>
								{h}
							</span>
						</ServerCard>
					</motion.div>
				))
			)}
		</div>
	)
}

function CredentialsStep() {
	const form = useFormContext()
	return (
		<div className='space-y-4 py-2'>
			<p className='text-sm font-medium'>
				{t('Add credentials for')} <span className='text-brand'>{form.watch('host')}</span>
			</p>

			{(['username', 'password'] as const).map((field) => {
				const labels = {
					username: t('files-add-network-share.username-label'),
					password: t('files-add-network-share.password-label'),
				}

				return (
					<FormField
						key={field}
						control={form.control}
						name={field}
						render={({field: f}) => (
							<FormItem>
								<FormLabel className='text-13 text-white/60'>{labels[field]}</FormLabel>
								<FormControl>
									{field === 'password' ? (
										<PasswordInput value={f.value} onValueChange={f.onChange} />
									) : (
										<Input type='text' {...f} />
									)}
								</FormControl>
								<div className='relative'>
									<FormMessage className='absolute -top-1 left-0 text-xs' />
								</div>
							</FormItem>
						)}
					/>
				)
			})}
		</div>
	)
}

function SelectShareStep({
	shares,
	isLoading,
	selectedShare,
	onSelect,
	disabled = false,
}: {
	shares: string[]
	isLoading: boolean
	selectedShare?: string
	onSelect: (s: string) => void
	disabled?: boolean
}) {
	return (
		<div className='space-y-4 py-2'>
			<p className='text-sm font-medium'>{t('files-add-network-share.select-share')}</p>

			{isLoading ? (
				<div className='flex flex-col items-center justify-center space-y-3 py-8'>
					<Loader2 className='h-8 w-8 animate-spin text-white/60 will-change-transform' />
					<p className='text-sm text-white/40'>{t('files-add-network-share.retrieving-shares')}</p>
				</div>
			) : (
				// RadioGroup only handles visual state - selection is handled by onClick on parent div so that entire div is clickable
				<RadioGroup value={selectedShare ?? ''} className='space-y-2'>
					{shares.map((s) => (
						<div
							key={s}
							onClick={disabled ? undefined : () => onSelect(s)}
							className={`flex items-center space-x-3 rounded-xl bg-white/5 p-4 ${
								selectedShare === s ? 'border border-brand bg-brand/15' : 'hover:bg-white/10'
							}
							${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
						>
							<RadioGroupItem value={s} id={s} />
							<FormLabel htmlFor={s} className='flex-1 cursor-pointer text-sm'>
								{s}
							</FormLabel>
						</div>
					))}
				</RadioGroup>
			)}
		</div>
	)
}
