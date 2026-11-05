import i18next from 'i18next'
import {useState} from 'react'
import {TbLoader} from 'react-icons/tb'

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {Switch} from '@/components/ui/switch'
import type {Machine} from '@/features/machines/types'
import {cn} from '@/lib/utils'
import {RouterOutput, trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

type UsbDevice = RouterOutput['machines']['usbDevices'][number]
type UsbHostUse = NonNullable<UsbDevice['hostUse']>
export type UsbDeviceIdentity = Pick<UsbDevice, 'vendorId' | 'productId' | 'serial' | 'port'>

// The Thunderbolt accessory's artwork, engraved with the USB trident
const usbAccessoryImage = '/assets/machines/usb-accessory.webp'

// Bus and device numbers change on every replug, so devices are matched by
// model, serial number, and physical port, exactly as umbreld does
export const usbDeviceKey = ({vendorId, productId, serial, port}: UsbDeviceIdentity) =>
	[vendorId, productId, serial ?? '', port].join('\n')

export const usbDeviceIdentity = ({vendorId, productId, serial, port}: UsbDeviceIdentity): UsbDeviceIdentity => ({
	vendorId,
	productId,
	serial,
	port,
})

// Legacy guests have no USB controller to pass devices through to
export const supportsUsbPassthrough = (machine: Machine) =>
	machine.platformProfile !== 'legacy-x86' && machine.platformProfile !== 'windows-98-x86'

// "dresden elektronik ConBee II", the way Thunderbolt accessories join vendor
// and name, without doubling a manufacturer the product name already starts with
const usbDeviceName = ({name, manufacturer}: UsbDevice) => {
	if (name && manufacturer && name.toLowerCase().startsWith(manufacturer.toLowerCase())) return name
	return [manufacturer, name].filter(Boolean).join(' ') || t('machines.usb-device-unnamed')
}

// The last hops of the port, e.g. 1.4 for a device on port 4 of a hub in port 1
const usbPortLabel = (port: string) => port.slice(port.lastIndexOf('/') + 1)

const appList = (hostUse: UsbHostUse) =>
	new Intl.ListFormat(i18next.language || undefined, {style: 'long', type: 'conjunction'}).format(
		(hostUse.apps ?? []).map(({name}) => name),
	)

// Switched off for this machine unless it's this machine's own: another
// machine has it, it's unplugged, or the host is using it in a way it can't
// give up
const isUnavailable = (device: UsbDevice, machine: Machine) =>
	device.machineId !== machine.id &&
	(!!device.machineId || !device.connected || (!!device.hostUse && !device.hostUse.takeable))

// The status dot, as Thunderbolt accessories show it: green while connected,
// amber while waiting on something, grey otherwise and fainter when unavailable
type StatusDot = 'connected' | 'pending' | 'idle' | 'unavailable'
const statusDotClass: Record<StatusDot, string> = {
	connected: 'bg-success-light',
	pending: 'bg-amber-400',
	idle: 'bg-white/40',
	unavailable: 'bg-white/20',
}

function hostUseStatus(hostUse: UsbHostUse) {
	switch (hostUse.reason) {
		case 'storage':
			return t('machines.usb-status-in-use-files')
		case 'network':
			return t('machines.usb-status-in-use-network')
		case 'in-use':
			return hostUse.apps
				? t('machines.usb-status-in-use-apps', {apps: appList(hostUse)})
				: t('machines.usb-status-in-use-host')
	}
}

// What the machine's own device is doing while the machine is off. It takes
// the device back from the host whenever it starts.
function untilStartStatus(hostUse: UsbHostUse, machineName: string) {
	switch (hostUse.reason) {
		case 'storage':
			return t('machines.usb-status-in-use-files-until-start', {machineName})
		case 'network':
			return t('machines.usb-status-in-use-network-until-start', {machineName})
		case 'in-use':
			return hostUse.apps
				? t('machines.usb-status-in-use-apps-until-start', {apps: appList(hostUse), machineName})
				: hostUseStatus(hostUse)
	}
}

// A row's status. A switch flipped but not saved yet says what Save will do.
function deviceStatus(
	device: UsbDevice,
	{machine, machines, isSelected}: {machine: Machine; machines: Machine[]; isSelected: boolean},
): {dot: StatusDot; text: string} {
	const own = device.machineId === machine.id
	const owner = device.machineId && !own ? machines.find((other) => other.id === device.machineId) : undefined
	const running = machine.state === 'running'
	const machineName = machine.name
	const hostUse = device.hostUse

	if (owner) return {dot: 'unavailable', text: t('machines.usb-status-connected-to', {machineName: owner.name})}
	if (!device.connected) return {dot: 'idle', text: t('machines.usb-status-not-plugged-in')}

	if (own && !isSelected) {
		// A running machine loses the device the moment the settings are saved
		return running
			? {dot: 'pending', text: t('machines.usb-status-disconnects-on-save', {machineName})}
			: {dot: 'pending', text: t('machines.usb-status-returns-on-save')}
	}
	if (!own && isSelected) {
		if (!hostUse) return {dot: 'pending', text: t('machines.usb-status-connects-on-save', {machineName})}
		switch (hostUse.reason) {
			case 'storage':
				return {dot: 'pending', text: t('machines.usb-status-moves-from-files-on-save', {machineName})}
			case 'network':
				return {dot: 'pending', text: t('machines.usb-status-moves-from-umbrel-on-save', {machineName})}
			case 'in-use':
				return hostUse.apps
					? {
							dot: 'pending',
							text: t('machines.usb-status-moves-from-apps-on-save', {apps: appList(hostUse), machineName}),
						}
					: {dot: 'pending', text: t('machines.usb-status-moves-from-umbrel-on-save', {machineName})}
		}
	}

	if (own) {
		// umbreld keeps retrying a device the host won't let go of
		if (hostUse && !hostUse.takeable) return {dot: 'pending', text: t('machines.usb-status-connects-when-free')}
		if (hostUse && !running) return {dot: 'idle', text: untilStartStatus(hostUse, machineName)}
		return running
			? {dot: 'connected', text: t('machines.usb-status-connected-to', {machineName})}
			: {dot: 'idle', text: t('machines.usb-status-connects-on-start', {machineName})}
	}

	if (!hostUse) return {dot: 'idle', text: t('machines.usb-status-available')}
	if (hostUse.takeable) return {dot: 'idle', text: hostUseStatus(hostUse)}
	switch (hostUse.reason) {
		case 'storage':
			return {dot: 'unavailable', text: t('machines.usb-status-needs-drive')}
		case 'network':
			return {dot: 'unavailable', text: t('machines.usb-status-needs-network')}
		case 'in-use':
			// An app driving the device directly through usbfs has to be stopped first
			return hostUse.apps
				? {
						dot: 'unavailable',
						text: t('machines.usb-status-stop-apps', {apps: appList(hostUse), count: hostUse.apps.length}),
					}
				: {dot: 'unavailable', text: t('machines.usb-status-in-use-host')}
	}
}

// What connecting a device the host is using does, for the dialog asking the
// user to agree. Nothing happens until the settings are saved.
function connectDialog(device: UsbDevice & {hostUse: UsbHostUse}, machineName: string) {
	const title = t('machines.usb-connect-title', {name: usbDeviceName(device), machineName})
	switch (device.hostUse.reason) {
		case 'storage':
			return {
				title,
				description: t('machines.usb-connect-drive-description', {machineName}),
				action: t('machines.usb-eject-and-connect'),
			}
		case 'network':
			return {
				title,
				description: t('machines.usb-connect-network-description', {machineName}),
				action: t('machines.usb-connect'),
			}
		case 'in-use':
			return {
				title,
				description: t('machines.usb-connect-apps-description', {apps: appList(device.hostUse), machineName}),
				action: t('machines.usb-connect'),
			}
	}
}

// The USB devices plugged into this Umbrel, each switchable on for this
// machine, plus any of its devices that are unplugged right now. Laid out like
// Settings › Thunderbolt, the other list of plugged-in hardware.
export function MachineUsbDevices({
	machine,
	machines,
	selected,
	onChange,
	disabled,
}: {
	machine: Machine
	machines: Machine[]
	selected: UsbDeviceIdentity[]
	onChange: (selected: UsbDeviceIdentity[]) => void
	disabled: boolean
}) {
	// A device the host is using, waiting for the user to agree to take it
	const [taking, setTaking] = useState<UsbDevice & {hostUse: UsbHostUse}>()
	// Devices come and go as they're plugged in, so keep the list fresh
	const devicesQuery = trpcReact.machines.usbDevices.useQuery(undefined, {refetchInterval: 2_000})
	const selectedKeys = new Set(selected.map(usbDeviceKey))
	// This machine's devices first, then free ones, then ones it can't have.
	// Sorted on saved state only, so a row never jumps while it's switched.
	const rank = (device: UsbDevice) => (device.machineId === machine.id ? 0 : isUnavailable(device, machine) ? 2 : 1)
	const devices = (devicesQuery.data ?? [])
		.filter((device) => device.connected || device.machineId === machine.id || selectedKeys.has(usbDeviceKey(device)))
		.map((device, index) => ({device, index}))
		.sort((a, b) => rank(a.device) - rank(b.device) || a.index - b.index)
		.map(({device}) => device)
	// Identical devices are only told apart by the port they're in
	const nameCounts = new Map<string, number>()
	for (const device of devices) {
		const name = usbDeviceName(device)
		nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1)
	}

	const toggle = (device: UsbDevice, on: boolean) => {
		const key = usbDeviceKey(device)
		if (!on) return onChange(selected.filter((other) => usbDeviceKey(other) !== key))
		// The machine's own devices are taken from apps whenever it runs, so only
		// ask before giving it a new one the host is using
		if (device.hostUse?.takeable && device.machineId !== machine.id)
			return setTaking({...device, hostUse: device.hostUse})
		onChange([...selected, usbDeviceIdentity(device)])
	}
	const takingDialog = taking && connectDialog(taking, machine.name)

	return (
		<div className='flex flex-col gap-3 py-5'>
			<div className='flex flex-col gap-1'>
				<span className='text-15 font-medium -tracking-2 text-white'>{t('machines.usb-devices')}</span>
				<p className='max-w-[460px] text-12 leading-snug -tracking-2 text-white/40'>
					{t('machines.usb-devices-description')}
				</p>
			</div>
			{devicesQuery.isPending ? (
				<div className='flex min-h-[68px] items-center justify-center'>
					<TbLoader className='size-6 animate-spin opacity-50' aria-label={t('loading')} />
				</div>
			) : devicesQuery.isError && !devicesQuery.data ? (
				<div className='flex min-h-36 flex-col items-center justify-center gap-2 rounded-12 bg-destructive/10 p-6 text-center'>
					<img
						src={usbAccessoryImage}
						alt=''
						draggable={false}
						className='size-12 object-contain opacity-30 grayscale'
					/>
					<div className='text-14 font-medium text-destructive2-lightest'>{t('machines.usb-devices-load-error')}</div>
				</div>
			) : devices.length === 0 ? (
				<div className='flex min-h-36 flex-col items-center justify-center gap-2 rounded-12 bg-white/4 p-6 text-center'>
					<img
						src={usbAccessoryImage}
						alt=''
						draggable={false}
						className='size-12 object-contain opacity-30 grayscale'
					/>
					<div className='text-14 font-medium text-white/70'>{t('machines.usb-devices-empty-title')}</div>
					<div className='max-w-72 text-12 leading-relaxed text-white/40'>
						{t('machines.usb-devices-empty-description')}
					</div>
				</div>
			) : (
				<div className='flex flex-col gap-2'>
					{devices.map((device) => {
						const key = usbDeviceKey(device)
						const isSelected = selectedKeys.has(key)
						// The machine's own devices can always be switched back and forth.
						// Others can only be switched on while nothing else has them, or
						// while the host is using them in a way it can give up.
						const unavailable = isUnavailable(device, machine)
						const interactive = !disabled && (isSelected || !unavailable)
						const name = usbDeviceName(device)
						const port = t('machines.usb-port', {port: usbPortLabel(device.port)})
						const status = deviceStatus(device, {machine, machines, isSelected})
						// A row that can't be switched has nothing to click
						const Row = interactive ? 'label' : 'div'
						return (
							<Row
								key={key}
								className={cn(
									'flex items-center gap-3 rounded-12 bg-white/6 p-3.5 transition-colors',
									interactive && 'cursor-pointer hover:bg-white/8',
								)}
							>
								<img
									src={usbAccessoryImage}
									alt=''
									draggable={false}
									className={cn('size-10 shrink-0 object-contain', !device.connected && 'opacity-40 grayscale')}
								/>
								<div className='min-w-0 flex-1 space-y-1'>
									{/* The IDs stay a hover away for matching a device to lsusb */}
									<h3
										className='truncate text-13 leading-tight font-medium'
										title={[`${device.vendorId}:${device.productId}`, device.serial, port].filter(Boolean).join(' · ')}
									>
										{name}
									</h3>
									<div className='flex items-start gap-1.5 text-11 leading-tight text-white/35'>
										<span className={cn('mt-1 size-1.5 shrink-0 rounded-full', statusDotClass[status.dot])} />
										<span>{(nameCounts.get(name) ?? 0) > 1 ? `${status.text} · ${port}` : status.text}</span>
									</div>
								</div>
								<Switch
									checked={isSelected}
									onCheckedChange={(on) => toggle(device, on)}
									disabled={disabled || (!isSelected && unavailable)}
									aria-label={t('machines.usb-connect-device', {name})}
								/>
							</Row>
						)
					})}
				</div>
			)}
			<AlertDialog open={!!taking} onOpenChange={(open) => !open && setTaking(undefined)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{takingDialog?.title}</AlertDialogTitle>
						<AlertDialogDescription>{takingDialog?.description}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogAction
							variant='primary'
							onClick={() => {
								if (taking) onChange([...selected, usbDeviceIdentity(taking)])
								setTaking(undefined)
							}}
						>
							{takingDialog?.action}
						</AlertDialogAction>
						<AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	)
}
