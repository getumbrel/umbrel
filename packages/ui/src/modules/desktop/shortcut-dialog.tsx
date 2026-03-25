import {AnimatePresence, motion} from 'motion/react'
import {useCallback, useEffect, useRef, useState} from 'react'
import {RiAddLine, RiArrowDownSLine} from 'react-icons/ri'
import {TbEdit, TbLoader} from 'react-icons/tb'

import {Popover, PopoverAnchor, PopoverContent} from '@/components/ui/popover'
import {useShortcuts} from '@/hooks/use-shortcuts'
import {cn} from '@/lib/utils'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

import {ShortcutIconImage} from './shortcut-icon-image'

type Protocol = 'https://' | 'http://' | 'umbrel'

const PROTOCOL_OPTIONS: {value: Protocol; label: string; labelTKey?: string; placeholderTKey: string}[] = [
	{value: 'https://', label: 'https://', placeholderTKey: 'example.com'},
	{value: 'http://', label: 'http://', placeholderTKey: 'example.com'},
	{
		value: 'umbrel',
		label: 'Custom Port',
		labelTKey: 'shortcut.add.custom-port',
		placeholderTKey: 'shortcut.add.custom-port-placeholder',
	},
]

/** Resolve a stored shortcut to an openable URL */
export function resolveShortcutUrl(shortcut: {url: string}): string {
	if (shortcut.url.startsWith('umbrel:')) {
		const {protocol, hostname} = window.location
		return `${protocol}//${hostname}:${shortcut.url.slice('umbrel:'.length)}`
	}
	return shortcut.url
}

export function ShortcutPopover({
	open,
	onOpenChange,
	anchorRef,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	anchorRef: React.RefObject<HTMLDivElement | null>
}) {
	const [protocol, setProtocol] = useState<Protocol>('https://')
	const [urlInput, setUrlInput] = useState('')
	const [showProtocolMenu, setShowProtocolMenu] = useState(false)
	const [title, setTitle] = useState('')
	const [icon, setIcon] = useState<string | undefined>(undefined)
	const [iconPreviewSrc, setIconPreviewSrc] = useState<string | undefined>(undefined)
	const [isFetching, setIsFetching] = useState(false)
	const [fetchFailed, setFetchFailed] = useState(false)
	const [hasFetched, setHasFetched] = useState(false)
	const [isEditingName, setIsEditingName] = useState(false)
	const [showShake, setShowShake] = useState(false)
	const [addError, setAddError] = useState(false)
	const fetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const userEditedTitleRef = useRef(false)
	const urlInputRef = useRef<HTMLInputElement>(null)
	const nameInputRef = useRef<HTMLInputElement>(null)

	// Clear pending debounce timeout on unmount
	useEffect(() => {
		return () => {
			if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current)
		}
	}, [])

	const {addAsync, isAdding} = useShortcuts()

	// Debounced params for the page metadata query — set after 600ms of no typing
	const [fetchParams, setFetchParams] = useState<{url: string} | null>(null)
	const pageMetadataQuery = trpcReact.shortcuts.fetchPageMetadata.useQuery(fetchParams!, {
		enabled: !!fetchParams,
		retry: false,
		gcTime: 0,
	})

	// React to query state changes
	useEffect(() => {
		if (!fetchParams) return
		if (pageMetadataQuery.isLoading) return

		if (pageMetadataQuery.isError) {
			setIsFetching(false)
			setFetchFailed(true)
			setHasFetched(true)
			return
		}

		if (pageMetadataQuery.data) {
			setIsFetching(false)
			setFetchFailed(false)
			setHasFetched(true)
			if (pageMetadataQuery.data.title && !userEditedTitleRef.current) {
				setTitle(pageMetadataQuery.data.title)
			}
			if (pageMetadataQuery.data.icon) {
				setIcon(pageMetadataQuery.data.icon)
				// For umbrel shortcuts, resolve icon URL relative to the device
				if (fetchParams.url.startsWith('umbrel:')) {
					const {protocol: p, hostname} = window.location
					const port = fetchParams.url.slice('umbrel:'.length).split('/')[0]
					setIconPreviewSrc(`${p}//${hostname}:${port}${new URL(pageMetadataQuery.data.icon).pathname}`)
				} else {
					setIconPreviewSrc(pageMetadataQuery.data.icon)
				}
			}
		}
	}, [pageMetadataQuery.data, pageMetadataQuery.isError, pageMetadataQuery.isLoading, fetchParams])

	/** Build the full URL from protocol + input */
	const buildFullUrl = useCallback((): string => {
		const input = urlInput.trim()
		if (!input) return ''
		if (protocol === 'umbrel') return `umbrel:${input}`
		return `${protocol}${input}`
	}, [protocol, urlInput])

	useEffect(() => {
		if (open) {
			setProtocol('https://')
			setUrlInput('')
			setTitle('')
			setIcon(undefined)
			setIconPreviewSrc(undefined)
			setFetchFailed(false)
			setIsFetching(false)
			setHasFetched(false)
			setFetchParams(null)

			setIsEditingName(false)
			setShowProtocolMenu(false)
			userEditedTitleRef.current = false
			setAddError(false)
		}
	}, [open])

	const triggerFetch = useCallback((input: string, proto: Protocol) => {
		if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current)

		// Immediately collapse preview on any new input
		setHasFetched(false)
		setIsFetching(false)
		setFetchParams(null)

		if (proto === 'umbrel') {
			const trimmed = input.trim()
			const port = trimmed.split('/')[0]
			if (!/^\d+$/.test(port)) return
		} else {
			const url = `${proto}${input.trim()}`
			if (url.length < 8) return
			try {
				new URL(url)
			} catch {
				return
			}
		}

		userEditedTitleRef.current = false
		fetchTimeoutRef.current = setTimeout(() => {
			setIsFetching(true)
			setFetchFailed(false)
			setIconPreviewSrc(undefined)
			setIcon(undefined)
			setIsEditingName(false)
			setTitle('')
			setFetchParams(proto === 'umbrel' ? {url: `umbrel:${input.trim()}`} : {url: `${proto}${input.trim()}`})
		}, 600)
	}, [])

	const handleUrlInputChange = (newInput: string) => {
		if (addError) setAddError(false)
		// Auto-detect and strip protocol from pasted URLs
		let cleaned = newInput
		let detectedProtocol = protocol
		if (cleaned.startsWith('https://')) {
			detectedProtocol = 'https://'
			cleaned = cleaned.slice('https://'.length)
			setProtocol('https://')
		} else if (cleaned.startsWith('http://')) {
			detectedProtocol = 'http://'
			cleaned = cleaned.slice('http://'.length)
			setProtocol('http://')
		}

		// Auto-switch to Custom Port when the URL points to this device
		if (detectedProtocol !== 'umbrel') {
			try {
				const parsed = new URL(`${detectedProtocol}${cleaned}`)
				if (parsed.hostname === window.location.hostname && parsed.port) {
					detectedProtocol = 'umbrel'
					setProtocol('umbrel')
					cleaned = parsed.port + (parsed.pathname !== '/' ? parsed.pathname : '') + parsed.search
				}
			} catch {
				// Not a valid URL yet — skip auto-detection
			}
		}

		setUrlInput(cleaned)
		if (cleaned.trim()) {
			triggerFetch(cleaned, detectedProtocol)
		} else {
			// Input cleared — cancel pending fetch and reset preview state
			if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current)
			setIsFetching(false)
			setHasFetched(false)
			setFetchFailed(false)
			setTitle('')
			setIcon(undefined)
			setIconPreviewSrc(undefined)
		}
	}

	const handleProtocolChange = (newProtocol: Protocol) => {
		setProtocol(newProtocol)
		setShowProtocolMenu(false)
		// Return focus to the URL input so the user can continue typing
		urlInputRef.current?.focus()
		// Re-fetch with new protocol if there's input
		if (urlInput.trim()) triggerFetch(urlInput, newProtocol)
	}

	const handleSubmit = () => {
		const fullUrl = buildFullUrl()
		const trimmedTitle = title.trim()
		if (!trimmedTitle || !fullUrl) return

		// For umbrel shortcuts, store the icon as umbrel:<port>/icon-path
		// instead of the full URL with IP, so it works when the IP changes
		let storedIcon = icon
		if (protocol === 'umbrel' && icon) {
			try {
				const parsed = new URL(icon)
				const port = urlInput.trim().split('/')[0]
				storedIcon = `umbrel:${port}${parsed.pathname}${parsed.search}`
			} catch {
				// Keep as-is if parsing fails
			}
		}

		addAsync({url: fullUrl, title: trimmedTitle, icon: storedIcon})
			.then(() => onOpenChange(false))
			.catch(() => {
				setAddError(true)
				setShowShake(true)
			})
	}

	const isSubmitting = isAdding
	const canSubmit = urlInput.trim().length > 0 && title.trim().length > 0 && !isSubmitting
	const showResult = hasFetched

	const currentOption = PROTOCOL_OPTIONS.find((p) => p.value === protocol)
	const currentProtocolLabel = currentOption?.labelTKey ? t(currentOption.labelTKey) : (currentOption?.label ?? '')

	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			<PopoverAnchor className='fixed' ref={anchorRef} />
			<PopoverContent
				align='start'
				sideOffset={8}
				className='!backdrop-blur-0 w-[280px] !border-none !bg-transparent !p-0 !shadow-none'
				onOpenAutoFocus={(e) => e.preventDefault()}
			>
				<div
					className={cn(
						'rounded-12 border-hpx border-white/10 bg-black/10 p-2 shadow-dock backdrop-blur-2xl',
						showShake && 'animate-shake',
					)}
					onAnimationEnd={() => setShowShake(false)}
				>
					{/* URL input row with protocol dropdown */}
					<div className='flex items-center'>
						{/* Protocol selector */}
						<div className='relative'>
							<button
								onClick={() => setShowProtocolMenu(!showProtocolMenu)}
								className='flex items-center gap-0.5 rounded-6 py-1.5 pr-1 pl-1.5 text-12 font-medium -tracking-2 text-white/80 transition-colors hover:bg-white/5 hover:text-white'
							>
								<span className='whitespace-nowrap'>{currentProtocolLabel}</span>
								<RiArrowDownSLine className='h-3 w-3' />
							</button>

							{/* Protocol dropdown */}
							<AnimatePresence>
								{showProtocolMenu && (
									<motion.div
										initial={{opacity: 0, y: -4}}
										animate={{opacity: 1, y: 0}}
										exit={{opacity: 0, y: -4}}
										transition={{duration: 0.15}}
										className='absolute top-full left-0 z-10 mt-1 overflow-hidden rounded-8 border-hpx border-white/10 bg-black/60 shadow-lg'
									>
										{PROTOCOL_OPTIONS.map((opt) => (
											<button
												key={opt.value}
												onClick={() => handleProtocolChange(opt.value)}
												className={cn(
													'flex w-full items-center px-3 py-1.5 text-12 font-medium -tracking-2 whitespace-nowrap transition-colors hover:bg-white/10',
													protocol === opt.value ? 'text-white' : 'text-white/70',
												)}
											>
												{opt.labelTKey ? t(opt.labelTKey) : opt.label}
											</button>
										))}
									</motion.div>
								)}
							</AnimatePresence>
						</div>

						<div className='relative min-w-0 flex-1'>
							<input
								ref={urlInputRef}
								value={urlInput}
								onChange={(e) => handleUrlInputChange(e.target.value)}
								placeholder={t(PROTOCOL_OPTIONS.find((p) => p.value === protocol)?.placeholderTKey ?? '')}
								autoFocus
								onFocus={() => setShowProtocolMenu(false)}
								onKeyDown={(e) => {
									if (e.key === 'Enter' && canSubmit) handleSubmit()
								}}
								className={cn(
									'w-full bg-transparent py-1.5 pl-1.5 text-13 font-medium -tracking-2 text-white/90 placeholder:!text-white/50 focus:outline-none',
									isFetching && 'pr-7',
								)}
								inputMode='url'
							/>
							{isFetching && (
								<TbLoader className='absolute top-1/2 right-1.5 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-white/40' />
							)}
						</div>
					</div>

					{/* Result row — icon + name + action */}
					<AnimatePresence>
						{showResult && (
							<motion.div
								initial={{height: 0}}
								animate={{height: 'auto'}}
								exit={{height: 0}}
								transition={{duration: 0.25, ease: [0.16, 1, 0.3, 1]}}
								className='overflow-hidden'
							>
								<motion.div
									initial={{opacity: 0, y: -8}}
									animate={{opacity: 1, y: 0}}
									exit={{opacity: 0, y: -8}}
									transition={{duration: 0.2, ease: [0.16, 1, 0.3, 1]}}
									className='flex items-center gap-2.5 px-1 pt-2 pb-1'
								>
									{/* Icon */}
									<ShortcutIconImage
										src={iconPreviewSrc ?? ''}
										title={title}
										className='h-9 w-9 shrink-0 rounded-10 ring-1 ring-white/10'
									/>

									{/* Name — text or inline input */}
									<div className='min-w-0 flex-1'>
										{isEditingName ? (
											<input
												ref={nameInputRef}
												value={title}
												onChange={(e) => {
													setTitle(e.target.value)
													userEditedTitleRef.current = true
												}}
												className='w-full bg-transparent text-13 font-medium -tracking-2 text-white/90 focus:outline-none'
												onKeyDown={(e) => {
													if (e.key === 'Enter') {
														setIsEditingName(false)
														if (canSubmit) handleSubmit()
													}
													if (e.key === 'Escape') setIsEditingName(false)
												}}
												onBlur={() => setIsEditingName(false)}
												autoFocus
											/>
										) : (
											<button
												onClick={() => {
													setIsEditingName(true)
													setTimeout(() => nameInputRef.current?.focus(), 50)
												}}
												className='group flex w-full min-w-0 items-center gap-1'
											>
												<span className='min-w-0 truncate text-13 font-medium -tracking-2 text-white/80'>
													{fetchFailed ? t('shortcut.add.fetch-failed') : title || '...'}
												</span>
												<TbEdit className='shrink-0 text-white/50 transition-colors group-hover:text-white/80' />
											</button>
										)}
									</div>

									{/* Add button */}
									{hasFetched && (
										<motion.button
											initial={{scale: 0.8, opacity: 0}}
											animate={{scale: 1, opacity: 1}}
											transition={{duration: 0.15}}
											disabled={!canSubmit}
											onClick={handleSubmit}
											className='flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/70 transition-all hover:bg-white/20 hover:text-white disabled:opacity-30 disabled:hover:bg-white/10'
										>
											<RiAddLine className='h-3.5 w-3.5' />
										</motion.button>
									)}
								</motion.div>
							</motion.div>
						)}
					</AnimatePresence>

					<AnimatePresence>
						{addError && (
							<motion.div
								initial={{height: 0, opacity: 0}}
								animate={{height: 'auto', opacity: 1}}
								exit={{height: 0, opacity: 0}}
								transition={{duration: 0.2, ease: [0.16, 1, 0.3, 1]}}
								className='overflow-hidden'
							>
								<p className='px-1 pt-1 pb-0.5 text-12 font-medium -tracking-2 text-white/50'>
									{t('shortcut.add.already-exists')}
								</p>
							</motion.div>
						)}
					</AnimatePresence>
				</div>
			</PopoverContent>
		</Popover>
	)
}
