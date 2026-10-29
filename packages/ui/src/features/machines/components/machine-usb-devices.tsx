import {Usb} from 'lucide-react'
import {useState} from 'react'

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

const appNames = (hostUse: UsbHostUse) => (hostUse.apps ?? []).map(({name}) => name).join(', ')

function hostUseLabel(hostUse: UsbHostUse) {
	switch (hostUse.reason) {
		case 'storage':
			return hostUse.takeable ? t('machines.usb-device-host-files') : t('machines.usb-device-host-storage')
		case 'network':
			return hostUse.takeable ? t('machines.usb-device-host-network') : t('machines.usb-device-host-network-only')
		case 'in-use':
			if (!hostUse.apps) return t('machines.usb-device-host-in-use')
			return hostUse.takeable
				? t('machines.usb-device-host-app', {apps: appNames(hostUse)})
				: t('machines.usb-device-host-app-claimed', {apps: appNames(hostUse)})
	}
}

// A machine takes the devices it has from the host whenever it starts
function takenOnStartLabel(hostUse: UsbHostUse) {
	switch (hostUse.reason) {
		case 'storage':
			return t('machines.usb-device-drive-taken-on-start')
		case 'network':
			return t('machines.usb-device-network-taken-on-start')
		case 'in-use':
			return t('machines.usb-device-taken-on-start', {apps: appNames(hostUse)})
	}
}

// What taking a device from the host does, for the dialog asking the user to agree
function takeDialog(device: UsbDevice & {hostUse: UsbHostUse}, machineName: string) {
	const name = device.name ?? t('machines.usb-device-unnamed')
	switch (device.hostUse.reason) {
		case 'storage':
			return {
				title: t('machines.usb-take-drive-title', {name}),
				description: t('machines.usb-take-drive-description', {name, machineName}),
				action: t('machines.usb-take-drive'),
			}
		case 'network':
			return {
				title: t('machines.usb-take-network-title', {name}),
				description: t('machines.usb-take-network-description', {name, machineName}),
				action: t('machines.usb-take-device'),
			}
		case 'in-use':
			return {
				title: t('machines.usb-take-device-title', {name, apps: appNames(device.hostUse)}),
				description: t('machines.usb-take-device-description', {
					name,
					apps: appNames(device.hostUse),
					machineName,
				}),
				action: t('machines.usb-take-device'),
			}
	}
}

// The USB devices plugged into this Umbrel, each switchable on for this
// machine, plus any of its devices that are unplugged right now
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
	const devices = (devicesQuery.data ?? []).filter(
		(device) => device.connected || device.machineId === machine.id || selectedKeys.has(usbDeviceKey(device)),
	)

	const toggle = (device: UsbDevice, on: boolean) => {
		const key = usbDeviceKey(device)
		if (!on) return onChange(selected.filter((other) => usbDeviceKey(other) !== key))
		// The machine's own devices are taken from apps whenever it runs, so only
		// ask before giving it a new one the host is using
		if (device.hostUse?.takeable && device.machineId !== machine.id)
			return setTaking({...device, hostUse: device.hostUse})
		onChange([...selected, usbDeviceIdentity(device)])
	}
	const takingDialog = taking && takeDialog(taking, machine.name)

	return (
		<div className='flex flex-col gap-3 py-5'>
			<div className='flex flex-col gap-1'>
				<span className='text-15 font-medium -tracking-2 text-white'>{t('machines.usb-devices')}</span>
				<p className='max-w-[460px] text-12 leading-snug -tracking-2 text-white/40'>
					{t('machines.usb-devices-description')}
				</p>
			</div>
			{devicesQuery.isSuccess && devices.length === 0 ? (
				<p className='rounded-8 bg-white/4 px-3 py-2.5 text-12 leading-snug -tracking-2 text-white/35'>
					{t('machines.usb-devices-empty')}
				</p>
			) : (
				<div className='flex flex-col gap-2'>
					{devices.map((device) => {
						const key = usbDeviceKey(device)
						const isSelected = selectedKeys.has(key)
						const owner =
							device.machineId && device.machineId !== machine.id
								? machines.find((other) => other.id === device.machineId)
								: undefined
						// The machine's own devices can always be switched back and forth.
						// Others can only be switched on while nothing else has them, or
						// while the host is using them in a way it can give up.
						const unavailable =
							device.machineId !== machine.id &&
							(!!owner || (!!device.hostUse && !device.hostUse.takeable) || !device.connected)
						const status = owner
							? t('machines.usb-device-assigned-to', {machineName: owner.name})
							: !device.connected
								? t('machines.usb-device-not-connected')
								: device.hostUse
									? device.machineId === machine.id && device.hostUse.takeable
										? takenOnStartLabel(device.hostUse)
										: hostUseLabel(device.hostUse)
									: undefined
						const name = device.name ?? t('machines.usb-device-unnamed')
						const details = [device.manufacturer, `${device.vendorId}:${device.productId}`].filter(Boolean).join(' · ')
						return (
							<label
								key={key}
								className={cn(
									'flex min-h-14 items-center gap-3 rounded-12 border-hpx border-white/10 bg-white/6 px-3.5 py-2.5',
									!isSelected && unavailable ? 'cursor-not-allowed' : 'cursor-pointer',
								)}
							>
								<Usb className={cn('size-4 shrink-0', device.connected ? 'text-white/60' : 'text-white/25')} />
								<div className='flex min-w-0 flex-1 flex-col gap-0.5'>
									<span
										className={cn(
											'truncate text-13 font-medium -tracking-2',
											device.connected ? 'text-white' : 'text-white/45',
										)}
									>
										{name}
									</span>
									<span className='truncate text-11 -tracking-2 text-white/35 tabular-nums'>{details}</span>
									{status && (
										<span
											className={cn(
												'text-11 leading-snug -tracking-2',
												device.hostUse && isSelected ? 'text-amber-200/80' : 'text-white/45',
											)}
										>
											{status}
										</span>
									)}
								</div>
								<Switch
									checked={isSelected}
									onCheckedChange={(on) => toggle(device, on)}
									disabled={disabled || (!isSelected && unavailable)}
									aria-label={name}
								/>
							</label>
						)
					})}
				</div>
			)}
			<AlertDialog open={!!taking} onOpenChange={(open) => !open && setTaking(undefined)}>
				<AlertDialogContent>
					<AlertDialogHeader icon={Usb}>
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
