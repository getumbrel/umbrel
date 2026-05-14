import {ChevronDown} from 'lucide-react'
import {AnimatePresence, motion} from 'motion/react'
import React, {useEffect, useRef, useState} from 'react'
import {Trans, useTranslation} from 'react-i18next'
import {BsEthernet} from 'react-icons/bs'
import {TbAlertTriangle, TbCheck, TbChevronLeft, TbChevronRight, TbInfoCircle, TbPencil, TbWifi} from 'react-icons/tb'

import {AlertDialog, AlertDialogContent} from '@/components/ui/alert-dialog'
import {Button} from '@/components/ui/button'
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {AnimatedInputError, Input, Labeled} from '@/components/ui/input'
import {toast} from '@/components/ui/toast'
import {useIsExternalDns} from '@/hooks/use-is-externaldns'
import {
	CONFIRMATION_TIMEOUT_SECONDS,
	useHostname,
	useNetworkInterfaces,
	useStaticIp,
	type NetworkInterface,
} from '@/hooks/use-network-settings'
import {cn} from '@/lib/utils'
import {useConfirmation} from '@/providers/confirmation'
import {useGlobalSystemState} from '@/providers/global-system-state'
import {linkClass} from '@/utils/element-classes'

const NETWORK_INTERFACES_REFETCH_INTERVAL_MS = 2000

function prefixToSubnetMask(prefix: number): string | null {
	if (prefix < 0 || prefix > 32 || !Number.isInteger(prefix)) return null
	const mask = prefix === 0 ? 0 : ~(2 ** (32 - prefix) - 1) >>> 0
	return [mask >>> 24, (mask >> 16) & 255, (mask >> 8) & 255, mask & 255].join('.')
}

type IpSettingsDraft = {
	ipMethod: 'dhcp' | 'static'
	ip: string
	subnet: string
	gateway: string
	dns: string
}

type ModeOption<T extends string> = {value: T; label: string; description?: string}

function getIpSettingsDraft(iface: NetworkInterface): IpSettingsDraft {
	// Prefer configured static settings (may be present even when disconnected)
	// over live values.
	if (iface.configuredStaticSettings) {
		return {
			ipMethod: 'static',
			ip: iface.configuredStaticSettings.ip,
			subnet: String(iface.configuredStaticSettings.subnetPrefix),
			gateway: iface.configuredStaticSettings.gateway,
			dns: iface.configuredStaticSettings.dns.join(', '),
		}
	}

	return {
		ipMethod: iface.ipMethod ?? 'dhcp',
		ip: iface.ip ?? '',
		subnet: iface.subnetPrefix != null ? String(iface.subnetPrefix) : '',
		gateway: iface.gateway ?? '',
		dns: iface.dns?.join(', ') ?? '',
	}
}

// ─── Status Dot ───────────────────────────────────────────────────────

function StatusDot({connected}: {connected: boolean}) {
	const solidColor = connected ? '#299E16' : '#DF1F1F'
	const bgColor = connected ? '#299E163D' : '#DF1F1F3D'
	return (
		<div className='grid size-2.5 shrink-0 place-items-center rounded-full' style={{backgroundColor: bgColor}}>
			<div className='size-1.5 rounded-full' style={{backgroundColor: solidColor}} />
		</div>
	)
}

// ─── Network Panel (main view) ──────────────────────────────────────

export function NetworkPanel({onBack}: {onBack: () => void}) {
	const {interfaces, isLoading, isError} = useNetworkInterfaces({
		refetchInterval: NETWORK_INTERFACES_REFETCH_INTERVAL_MS,
		staleTime: 0,
	})
	const [selectedMac, setSelectedMac] = useState<string | null>(null)
	const selectedInterface = selectedMac ? interfaces?.find((iface) => iface.mac === selectedMac) : null

	return selectedInterface ? (
		<InterfaceDetail key={selectedInterface.mac} iface={selectedInterface} onBack={() => setSelectedMac(null)} />
	) : (
		<NetworkMainView
			onBack={onBack}
			interfaces={interfaces}
			isLoading={isLoading}
			isError={isError}
			onSelectInterface={(iface) => setSelectedMac(iface.mac)}
		/>
	)
}

function NetworkMainView({
	onBack,
	interfaces,
	isLoading,
	isError,
	onSelectInterface,
}: {
	onBack: () => void
	interfaces: NetworkInterface[] | undefined
	isLoading: boolean
	isError: boolean
	onSelectInterface: (iface: NetworkInterface) => void
}) {
	const {t} = useTranslation()

	return (
		<div className='flex flex-col gap-y-5'>
			<BackButton onClick={onBack}>{t('advanced-settings')}</BackButton>

			<HostnameSection />

			<Divider />

			<InterfacesList
				interfaces={interfaces}
				isLoading={isLoading}
				isError={isError}
				onSelectInterface={onSelectInterface}
			/>

			<Divider />

			<DnsSection />
		</div>
	)
}

// ─── Hostname Section ───────────────────────────────────────────────
// Before changing the hostname, we detect whether the user is on a hostname-based URL (.local / bare) or IP
// - Hostname access: we warn that connection will be lost, show new .local URL
// - IP access: we warn that the IP may change via DHCP, suggest new .local URL as fallback
// Could consider auto-redirecting for hostname access, but avahi broadcast timing is unpredictable

function HostnameSection() {
	const {t} = useTranslation()
	const [isEditing, setIsEditing] = useState(false)
	const [editValue, setEditValue] = useState('')
	const [validationError, setValidationError] = useState<string | null>(null)

	const {hostname, setHostname, isPending} = useHostname({
		onSuccess: () => setIsEditing(false),
	})

	const editingRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (!isEditing) return
		const handleClickOutside = (e: MouseEvent) => {
			if (editingRef.current && !editingRef.current.contains(e.target as Node)) {
				setIsEditing(false)
				setValidationError(null)
			}
		}
		document.addEventListener('mousedown', handleClickOutside)
		return () => document.removeEventListener('mousedown', handleClickOutside)
	}, [isEditing])

	const startEditing = () => {
		setEditValue(hostname)
		setValidationError(null)
		setIsEditing(true)
	}

	// Client-side validation is shown inline under the input.
	// Backend errors (system failures, etc.) are toasted by the useHostname hook.
	const validateHostname = (value: string): string | null => {
		if (!value) return t('network.hostname-error-invalid')
		if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(value)) return t('network.hostname-error-invalid')
		if (value.length > 63) return t('network.hostname-error-invalid')
		if (['localhost', 'broadcasthost'].includes(value)) return t('network.hostname-error-reserved')
		return null
	}

	const confirm = useConfirmation()

	const handleSave = async () => {
		const error = validateHostname(editValue)
		if (error) {
			setValidationError(error)
			return
		}
		if (editValue === hostname) {
			setIsEditing(false)
			return
		}
		const host = window.location.hostname
		const isHostnameAccess = host === hostname || host === `${hostname}.local`

		try {
			const result = await confirm({
				title: t('network.hostname-confirm-title'),
				// Use literal keys (not a variable) so the translation CI's unused-key scanner can find them
				message: isHostnameAccess
					? t('network.hostname-confirm-message-hostname-access', {currentHostname: hostname, newHostname: editValue})
					: t('network.hostname-confirm-message-ip-access', {currentHostname: hostname, newHostname: editValue}),
				actions: [
					{label: t('network.hostname-confirm-continue'), value: 'confirm', variant: 'primary'},
					{label: t('cancel'), value: 'cancel', variant: 'default'},
				],
			})
			if (result.actionValue !== 'confirm') return
		} catch {
			return
		}
		setHostname(editValue)
	}

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter') handleSave()
		if (e.key === 'Escape') setIsEditing(false)
	}

	const displayedHostname = isEditing ? editValue || hostname : hostname

	return (
		<div className='flex flex-col gap-1'>
			<div className='flex items-start justify-between gap-4'>
				<div className='flex-1'>
					<div className='text-13 font-medium -tracking-2'>{t('network.hostname')}</div>
					<div className='text-12 leading-tight text-white/40'>
						<Trans
							i18nKey='network.hostname-accessible-at'
							values={{hostname: displayedHostname}}
							components={{
								linked: isEditing ? (
									<span />
								) : (
									<a
										href={`http://${displayedHostname}.local`}
										target='_blank'
										rel='noopener noreferrer'
										className={linkClass}
									/>
								),
							}}
						/>
					</div>
				</div>
				{isEditing ? (
					<div ref={editingRef} className='flex items-center gap-1.5'>
						<Input
							sizeVariant='short-square'
							value={editValue}
							onValueChange={(v) => {
								setEditValue(v.toLowerCase())
								setValidationError(null)
							}}
							onKeyDown={handleKeyDown}
							autoFocus
							className='w-[140px]'
						/>
						<button
							onClick={handleSave}
							disabled={isPending}
							className='rounded-full p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white'
						>
							{isPending ? (
								<div className='size-4 animate-spin rounded-full border-2 border-white/20 border-t-white/60' />
							) : (
								<TbCheck className='size-4' />
							)}
						</button>
					</div>
				) : (
					<button
						onClick={startEditing}
						className='flex items-center gap-1.5 rounded-8 px-2 py-1 text-white/60 transition-colors hover:bg-white/6 hover:text-white/80'
					>
						<span className='text-13 font-medium -tracking-2'>{hostname}</span>
						<TbPencil className='size-3 text-white/30' />
					</button>
				)}
			</div>
			<AnimatedInputError>{validationError}</AnimatedInputError>
		</div>
	)
}

// ─── Interfaces List ────────────────────────────────────────────────

function InterfacesList({
	interfaces,
	isLoading,
	isError,
	onSelectInterface,
}: {
	interfaces: NetworkInterface[] | undefined
	isLoading: boolean
	isError: boolean
	onSelectInterface: (iface: NetworkInterface) => void
}) {
	const {t} = useTranslation()

	return (
		<div className='flex flex-col gap-2.5'>
			<SectionLabel>{t('network.interfaces')}</SectionLabel>

			{isLoading ? (
				<div className='flex flex-col gap-2'>
					<SkeletonCard />
					<SkeletonCard />
				</div>
			) : isError ? (
				<div className='grid h-20 place-items-center rounded-12 bg-white/5'>
					<div className='text-center text-13 text-white/40'>{t('network.interfaces-error')}</div>
				</div>
			) : !interfaces?.length ? (
				<div className='grid h-20 place-items-center rounded-12 bg-white/5'>
					<div className='text-center text-13 text-white/40'>{t('network.interfaces-empty')}</div>
				</div>
			) : (
				<div className='flex flex-col gap-2'>
					{interfaces.map((iface) => (
						<InterfaceCard key={iface.mac} iface={iface} onSelect={() => onSelectInterface(iface)} />
					))}
				</div>
			)}
		</div>
	)
}

function InterfaceCard({iface, onSelect}: {iface: NetworkInterface; onSelect: () => void}) {
	const {t} = useTranslation()
	const Icon = iface.type === 'wifi' ? TbWifi : BsEthernet
	const label = iface.type === 'wifi' ? t('network.detail-type-wifi') : t('network.interface-ethernet')

	// Prefer the live IP, but keep static config visible when disconnected.
	const displayIp = iface.ip ?? iface.configuredStaticSettings?.ip
	const isStaticConfigured = !!iface.configuredStaticSettings

	return (
		<button
			onClick={onSelect}
			className='flex w-full items-center gap-3 rounded-12 bg-white/6 p-3 text-left transition-colors hover:bg-white/8'
		>
			<div className='flex size-8 shrink-0 items-center justify-center rounded-8 bg-white/6'>
				<Icon className='size-4 text-white/50' />
			</div>
			<div className='min-w-0 flex-1'>
				<div className='flex items-center gap-2'>
					<span className='text-13 font-medium -tracking-2'>{label}</span>
					<span className='text-11 text-white/25'>{iface.id}</span>
				</div>
				<div className='flex items-center gap-1.5 text-12 text-white/40'>
					<StatusDot connected={iface.connected} />
					<span>{iface.connected ? t('network.interface-connected') : t('network.interface-disconnected')}</span>
					{displayIp && (
						<>
							<span className='text-white/15'>·</span>
							<span>
								{isStaticConfigured && <span className='mr-1 text-white/25'>{t('network.ipv4-static')}:</span>}
								{displayIp}
							</span>
						</>
					)}
				</div>
			</div>
			<TbChevronRight className='size-4 shrink-0 text-white/20' />
		</button>
	)
}

function SkeletonCard() {
	return (
		<div className='flex items-center gap-3 rounded-12 bg-white/6 p-3'>
			<div className='size-8 animate-pulse rounded-8 bg-white/8' />
			<div className='flex-1 space-y-1.5'>
				<div className='h-3 w-20 animate-pulse rounded bg-white/8' />
				<div className='h-2.5 w-36 animate-pulse rounded bg-white/8' />
			</div>
		</div>
	)
}

// ─── DNS Section ────────────────────────────────────────────────────

function DnsSection() {
	const {t} = useTranslation()
	const {isChecked, change, isLoading} = useIsExternalDns()
	const mode: 'cloudflare' | 'router' = isChecked ? 'cloudflare' : 'router'

	const handleModeChange = (newMode: 'cloudflare' | 'router') => {
		change(newMode === 'cloudflare')
	}

	const dnsOptions = [
		{
			value: 'cloudflare' as const,
			label: t('network.dns-cloudflare'),
			description: t('network.dns-cloudflare-description'),
		},
		{value: 'router' as const, label: t('network.dns-router'), description: t('network.dns-router-description')},
	]

	const description =
		mode === 'cloudflare' ? t('network.dns-cloudflare-description') : t('network.dns-router-description')

	return (
		<div className='flex flex-col gap-2.5'>
			<div className='flex items-center justify-between gap-4'>
				<div className='flex-1'>
					<div className='text-13 font-medium -tracking-2'>{t('network.dns')}</div>
					<div className='text-12 leading-tight text-white/35'>{description}</div>
				</div>
				<ModeDropdown value={mode} options={dnsOptions} onValueChange={handleModeChange} isLoading={isLoading} />
			</div>
		</div>
	)
}

// ─── Mode Dropdown ──────────────────────────────────────────────────

function ModeDropdown<T extends string>({
	value,
	options,
	onValueChange,
	isLoading,
	disabled,
}: {
	value: T
	options: ModeOption<T>[]
	onValueChange: (value: T) => void
	isLoading?: boolean
	disabled?: boolean
}) {
	const selectedLabel = options.find((o) => o.value === value)?.label ?? value

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild disabled={isLoading || disabled}>
				<button
					className={cn(
						'flex items-center gap-1.5 rounded-8 bg-white/6 px-3 py-2 text-13 font-medium -tracking-2 text-white/70 transition-colors hover:bg-white/10 disabled:cursor-not-allowed',
						isLoading && 'umbrel-pulse',
					)}
				>
					{selectedLabel}
					<ChevronDown className='size-3.5 text-white/40' />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='end' className='min-w-[200px]'>
				{options.map((opt) => (
					<DropdownMenuCheckboxItem
						key={opt.value}
						checked={value === opt.value}
						onSelect={() => onValueChange(opt.value)}
					>
						<div>
							<div>{opt.label}</div>
							{opt.description && <div className='text-11 font-normal opacity-50'>{opt.description}</div>}
						</div>
					</DropdownMenuCheckboxItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

// ─── Interface Detail (drill-down) ──────────────────────────────────

function InterfaceDetail({iface, onBack}: {iface: NetworkInterface; onBack: () => void}) {
	const {t} = useTranslation()
	const {suppressErrors} = useGlobalSystemState()

	const [initial] = useState(() => getIpSettingsDraft(iface))

	const [ipMethod, setIpMethod] = useState<'dhcp' | 'static'>(initial.ipMethod)
	const [ip, setIp] = useState(initial.ip)
	const [subnet, setSubnet] = useState(initial.subnet)
	const [gateway, setGateway] = useState(initial.gateway)
	const [dns, setDns] = useState(initial.dns)
	const [hasEditedStaticFields, setHasEditedStaticFields] = useState(false)
	const [shouldHydrateStaticFields] = useState(() => !initial.ip && !initial.subnet && !initial.gateway && !initial.dns)

	// If Ethernet reconnects after opening with blank values, hydrate once from live data.
	// Stop as soon as the user edits so polling never overwrites their draft.
	useEffect(() => {
		if (!shouldHydrateStaticFields) return
		if (!iface.connected) return
		if (hasEditedStaticFields) return

		const liveDraft = getIpSettingsDraft(iface)
		if (!liveDraft.ip && !liveDraft.subnet && !liveDraft.gateway && !liveDraft.dns) return

		setIp(liveDraft.ip)
		setSubnet(liveDraft.subnet)
		setGateway(liveDraft.gateway)
		setDns(liveDraft.dns)
	}, [iface, hasEditedStaticFields, shouldHydrateStaticFields])

	const updateStaticField = (setter: (value: string) => void) => (value: string) => {
		setHasEditedStaticFields(true)
		setter(value)
	}

	// Used to show override notes when Cloudflare DNS is enabled: interface DNS is ignored system-wide
	const {isChecked: isCloudflareDnsEnabled} = useIsExternalDns()

	const {setStaticIp, clearStaticIp, isSettingStaticIp, isClearing} = useStaticIp(iface.mac, {onSettled: onBack})
	const [tabOpened, setTabOpened] = useState(false)

	// Two-phase countdown for the confirmation dialog:
	// Phase 1 (TAB_OPEN_DELAY seconds): "opening new tab..." countdown before tab opens
	// Phase 2 (remaining time): "new tab was opened..." countdown while waiting for confirmation
	const TAB_OPEN_DELAY = 3
	const [countdownSeconds, setCountdownSeconds] = useState(TAB_OPEN_DELAY)
	useEffect(() => {
		if (!isSettingStaticIp) {
			setCountdownSeconds(TAB_OPEN_DELAY)
			setTabOpened(false)
			return
		}
		const interval = setInterval(() => {
			setCountdownSeconds((s) => Math.max(0, s - 1))
		}, 1000)
		return () => clearInterval(interval)
	}, [isSettingStaticIp])

	const confirm = useConfirmation()

	const isValidIpv4 = (value: string) => /^(\d{1,3}\.){3}\d{1,3}$/.test(value)

	const handleApply = async () => {
		if (ipMethod === 'dhcp') {
			clearStaticIp()
			return
		}

		const subnetPrefix = parseInt(subnet, 10)
		const dnsServers = dns
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean)

		// Basic client-side validation matching the backend's zod schema.
		// First error stops — keeps it simple for an advanced settings form.
		if (!ip || !isValidIpv4(ip)) return toast.error(t('network.invalid-ip'))
		if (Number.isNaN(subnetPrefix) || subnetPrefix < 0 || subnetPrefix > 32)
			return toast.error(t('network.invalid-subnet'))
		if (!gateway || !isValidIpv4(gateway)) return toast.error(t('network.invalid-gateway'))
		if (dnsServers.length === 0 || dnsServers.some((s) => !isValidIpv4(s))) return toast.error(t('network.invalid-dns'))

		// Always use the new-tab confirmation flow, even if the IP matches the current one.
		// The backend bounces the interface (nmcli down/up) which breaks the current tab's
		// connection, making it unreliable to confirm from here. The new tab opens a fresh
		// connection that isn't affected by the bounce.
		try {
			const result = await confirm({
				title: t('network.static-ip-confirm-title'),
				message: t('network.static-ip-confirm-message', {newIp: ip}),
				actions: [
					{label: t('network.static-ip-confirm-continue'), value: 'confirm', variant: 'primary'},
					{label: t('cancel'), value: 'cancel', variant: 'default'},
				],
			})
			if (result.actionValue !== 'confirm') return
		} catch {
			return
		}

		// Suppress global "checking backend" errors while the interface bounces
		suppressErrors()
		setStaticIp({ip, subnetPrefix, gateway, dns: dnsServers})

		// Wait for the interface to bounce (nmcli down/up) before opening the new tab,
		// reducing the chance of the browser showing a brief "can't reach" error.
		setTimeout(() => {
			window.open(`http://${ip}/confirm-static-ip`, '_blank')
			setTabOpened(true)
			setCountdownSeconds(CONFIRMATION_TIMEOUT_SECONDS - TAB_OPEN_DELAY)
		}, TAB_OPEN_DELAY * 1000)
	}

	const displayName = iface.type === 'wifi' ? t('network.detail-type-wifi') : t('network.interface-ethernet')

	const ipv4Options: ModeOption<'dhcp' | 'static'>[] = [
		{value: 'dhcp' as const, label: t('network.ipv4-automatic'), description: t('network.ipv4-automatic-description')},
		{value: 'static' as const, label: t('network.ipv4-static'), description: t('network.ipv4-static-description')},
	]

	const subnetMask = prefixToSubnetMask(parseInt(subnet, 10))
	const subnetLabel = subnetMask ? `${t('network.ipv4-subnet')} · ${subnetMask}` : t('network.ipv4-subnet')

	const isApplying = isSettingStaticIp || isClearing
	const hasStaticFieldChanges =
		(ipMethod === 'static' || initial.ipMethod === 'static') &&
		(ip !== initial.ip || subnet !== initial.subnet || gateway !== initial.gateway || dns !== initial.dns)
	const hasChanges = ipMethod !== initial.ipMethod || hasStaticFieldChanges

	// When disconnected, only allow switching from static back to DHCP (recovery path).
	// Setting a static IP requires the confirmation flow which needs a reachable interface.
	const canEditStaticIp = iface.connected
	const canApply = hasChanges && (iface.connected || (initial.ipMethod === 'static' && ipMethod === 'dhcp'))

	return (
		<div className='flex flex-col gap-y-5'>
			<BackButton onClick={onBack}>{t('network')}</BackButton>

			{/* Title */}
			<div className='text-15 font-semibold -tracking-2'>{displayName}</div>

			{/* Info list — live state (read-only) */}
			<div className='flex flex-col gap-px overflow-hidden rounded-12 bg-white/[0.03]'>
				<InfoRow label={t('network.detail-interface')} value={iface.id} />
				<InfoRow
					label={t('network.detail-status')}
					value={
						<span className='flex items-center gap-1.5'>
							<StatusDot connected={iface.connected} />
							{iface.connected ? t('network.interface-connected') : t('network.interface-disconnected')}
						</span>
					}
				/>
				<InfoRow
					label={t('network.detail-type')}
					value={iface.type === 'wifi' ? t('network.detail-type-wifi') : t('network.detail-type-ethernet')}
				/>
				<InfoRow label={t('network.detail-mac')} value={<span className='font-mono text-11'>{iface.mac}</span>} />
				<InfoRow label={t('network.ipv4-address')} value={iface.ip ?? '—'} />
				<InfoRow
					label={t('network.ipv4-subnet')}
					value={iface.subnetPrefix != null ? `${iface.subnetPrefix} (${prefixToSubnetMask(iface.subnetPrefix)})` : '—'}
				/>
				<InfoRow label={t('network.ipv4-gateway')} value={iface.gateway ?? '—'} />
				<InfoRow
					label={t('network.dns')}
					value={iface.dns?.join(', ') ?? '—'}
					note={isCloudflareDnsEnabled ? t('network.dns-cloudflare-override-note') : undefined}
					dimValue={isCloudflareDnsEnabled}
				/>
			</div>

			{iface.type === 'ethernet' ? (
				<>
					{/* Device IP address section */}
					<div className='flex flex-col gap-3'>
						<SectionLabel>{t('network.device-ip')}</SectionLabel>

						<div className='flex flex-col gap-2.5'>
							<div className='flex items-center justify-between gap-4'>
								<div className='flex-1'>
									<div className='text-13 font-medium -tracking-2'>{t('network.ipv4')}</div>
									<div className='text-12 leading-tight text-white/35'>
										{ipMethod === 'dhcp'
											? t('network.ipv4-automatic-description')
											: t('network.ipv4-static-description')}
									</div>
								</div>
								<ModeDropdown value={ipMethod} options={ipv4Options} onValueChange={setIpMethod} />
							</div>

							<AnimatePresence>
								{ipMethod === 'static' && (
									<motion.div
										initial={{height: 0, opacity: 0}}
										animate={{height: 'auto', opacity: 1}}
										exit={{height: 0, opacity: 0}}
										transition={{duration: 0.2}}
										className='overflow-hidden'
									>
										<div className='flex flex-col gap-2.5 py-1'>
											<div className='flex gap-2'>
												<div className='flex-1'>
													<Labeled label={t('network.ipv4-address')}>
														<Input
															sizeVariant='short-square'
															placeholder='192.168.1.100'
															value={ip}
															onValueChange={updateStaticField(setIp)}
															disabled={!canEditStaticIp}
														/>
													</Labeled>
												</div>
												<div className='flex-1'>
													<Labeled label={subnetLabel}>
														<Input
															sizeVariant='short-square'
															placeholder='24'
															value={subnet}
															onValueChange={updateStaticField(setSubnet)}
															disabled={!canEditStaticIp}
														/>
													</Labeled>
												</div>
											</div>
											<div className='flex gap-2'>
												<div className='flex-1'>
													<Labeled label={t('network.ipv4-gateway')}>
														<Input
															sizeVariant='short-square'
															placeholder='192.168.1.1'
															value={gateway}
															onValueChange={updateStaticField(setGateway)}
															disabled={!canEditStaticIp}
														/>
													</Labeled>
												</div>
											</div>
											<div className='flex flex-1 flex-col gap-1.5'>
												<Labeled label={t('network.dns')}>
													<Input
														sizeVariant='short-square'
														placeholder={t('network.dns-custom-placeholder')}
														value={dns}
														onValueChange={updateStaticField(setDns)}
														disabled={!canEditStaticIp}
													/>
												</Labeled>
												{isCloudflareDnsEnabled && (
													<div className='flex items-start gap-1.5 px-[5px]'>
														<TbInfoCircle className='mt-0.5 size-3.5 shrink-0 text-white/30' />
														<span className='text-11 leading-snug text-white/35'>
															{t('network.dns-cloudflare-override-form-note')}
														</span>
													</div>
												)}
											</div>
										</div>
									</motion.div>
								)}
							</AnimatePresence>
						</div>
					</div>

					{/* Warning */}
					{ipMethod === 'static' && (
						<div className='flex items-start gap-2 rounded-10 bg-yellow-500/10 p-3'>
							<TbAlertTriangle className='mt-0.5 size-4 shrink-0 text-yellow-400/80' />
							<span className='text-12 leading-tight text-yellow-200/70'>{t('network.static-ip-warning')}</span>
						</div>
					)}

					<Divider />

					{/* Buttons */}
					<div className='flex flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between'>
						{ipMethod === 'static' && !iface.connected ? (
							<div className='flex min-w-0 items-start gap-1.5 text-11 leading-snug text-white/35 sm:max-w-[260px]'>
								<TbInfoCircle className='mt-0.5 size-3.5 shrink-0 text-white/30' />
								<span>{t('network.static-ip-disconnected-note')}</span>
							</div>
						) : (
							<div />
						)}
						<Button variant='primary' size='md' onClick={handleApply} disabled={isApplying || !canApply}>
							{isApplying ? t('network.applying') : t('network.apply')}
						</Button>
					</div>
				</>
			) : (
				<div className='rounded-10 bg-white/5 p-3 text-12 leading-snug text-white/50'>
					{t('network.static-ip-ethernet-only')}
				</div>
			)}

			{/* Non-dismissable dialog shown while the static IP mutation is in flight.
			    The user is typically on the new tab; they only see this if they navigate back.
			    On success: dialog closes, onBack navigates to interface list.
			    On timeout: dialog closes, error toast shows, interface data reverts.
			    InterfaceDetail stays mounted so the hook's callbacks fire properly. */}
			<AlertDialog open={isSettingStaticIp}>
				<AlertDialogContent
					onEscapeKeyDown={(e) => e.preventDefault()}
					onPointerDownOutside={(e) => e.preventDefault()}
				>
					<div className='flex flex-col items-center gap-6 py-4'>
						<ConfirmationOverlay
							seconds={countdownSeconds}
							total={tabOpened ? CONFIRMATION_TIMEOUT_SECONDS - TAB_OPEN_DELAY : TAB_OPEN_DELAY}
							newIp={ip || '—'}
							tabOpened={tabOpened}
						/>
					</div>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	)
}

// ─── Shared ─────────────────────────────────────────────────────────

function BackButton({onClick, children}: {onClick: () => void; children: React.ReactNode}) {
	return (
		<button
			onClick={onClick}
			className='-ml-1 flex items-center gap-0.5 self-start text-13 font-medium -tracking-2 text-white/50 transition-colors hover:text-white/70'
		>
			<TbChevronLeft className='size-4' />
			{children}
		</button>
	)
}

function SectionLabel({children}: {children: React.ReactNode}) {
	return <div className='text-12 font-semibold tracking-wide text-white/40 uppercase'>{children}</div>
}

function Divider() {
	return <div className='h-px bg-white/5' />
}

function InfoRow({
	label,
	value,
	note,
	dimValue,
}: {
	label: string
	value: React.ReactNode
	note?: string
	dimValue?: boolean
}) {
	return (
		<div className='flex flex-col gap-1 bg-white/[0.03] px-3.5 py-2.5'>
			<div className='flex items-center justify-between'>
				<span className='text-13 text-white/40'>{label}</span>
				<span className={cn('text-13', dimValue ? 'text-white/30 line-through' : 'text-white/60')}>{value}</span>
			</div>
			{note && <span className='text-11 leading-snug text-white/30'>{note}</span>}
		</div>
	)
}

// ─── Confirmation Overlay ───────────────────────────────────────────

const CIRCLE_SIZE = 100
const STROKE_WIDTH = 4
const RADIUS = (CIRCLE_SIZE - STROKE_WIDTH) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

function ConfirmationOverlay({
	seconds,
	total,
	newIp,
	tabOpened,
}: {
	seconds: number
	total: number
	newIp: string
	tabOpened: boolean
}) {
	const {t} = useTranslation()

	// Continuous ring animation driven by elapsed time via requestAnimationFrame.
	// The `seconds` prop (integer countdown) is used for the number display only.
	// The ring depletes smoothly and stays perfectly synced with real time.
	const startTimeRef = useRef(Date.now())
	const [ringProgress, setRingProgress] = useState(1)

	// Reset start time when total changes (phase transition)
	useEffect(() => {
		startTimeRef.current = Date.now()
		setRingProgress(1)
	}, [total])

	useEffect(() => {
		let frameId: number
		const animate = () => {
			const elapsed = (Date.now() - startTimeRef.current) / 1000
			setRingProgress(total > 0 ? Math.max(0, 1 - elapsed / total) : 0)
			frameId = requestAnimationFrame(animate)
		}
		frameId = requestAnimationFrame(animate)
		return () => cancelAnimationFrame(frameId)
	}, [total])

	const dashOffset = CIRCUMFERENCE * (1 - ringProgress)

	return (
		<div className='flex flex-col items-center gap-6'>
			{/* Circular timer */}
			<div className='relative flex items-center justify-center'>
				<svg width={CIRCLE_SIZE} height={CIRCLE_SIZE} className='-rotate-90'>
					{/* Background ring */}
					<circle
						cx={CIRCLE_SIZE / 2}
						cy={CIRCLE_SIZE / 2}
						r={RADIUS}
						fill='none'
						stroke='rgba(255,255,255,0.08)'
						strokeWidth={STROKE_WIDTH}
					/>
					{/* Progress ring */}
					<circle
						cx={CIRCLE_SIZE / 2}
						cy={CIRCLE_SIZE / 2}
						r={RADIUS}
						fill='none'
						stroke='hsl(var(--color-brand))'
						strokeWidth={STROKE_WIDTH}
						strokeLinecap='round'
						strokeDasharray={CIRCUMFERENCE}
						strokeDashoffset={dashOffset}
					/>
				</svg>
				<span className='absolute text-24 font-bold -tracking-2 tabular-nums'>{seconds}</span>
			</div>

			{/* The "open it manually" fallback link handles Safari which blocks window.open inside
			    setTimeout (transient user activation expires). We delay opening the tab to reduce
			    the chance of a "can't reach" error while the interface bounces. A blank tab during
			    that delay is worse UX than a fallback link. Chrome/Firefox auto-open fine. */}
			<div className='flex flex-col items-center gap-2 text-center'>
				<h2 className='text-15 font-semibold -tracking-2'>{t('network.confirm-title', {newIp})}</h2>
				<p className='max-w-[440px] text-13 leading-snug text-white/50'>
					{tabOpened ? (
						<Trans
							i18nKey='network.confirm-body'
							values={{newIp}}
							components={{
								linked: (
									<a
										href={`http://${newIp}/confirm-static-ip`}
										target='_blank'
										rel='noopener noreferrer'
										className={linkClass}
									/>
								),
							}}
						/>
					) : (
						t('network.confirm-body-waiting')
					)}
				</p>
			</div>
		</div>
	)
}
