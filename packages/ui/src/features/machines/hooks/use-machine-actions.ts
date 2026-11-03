import {toast} from '@/components/ui/toast'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

// Maps backend `[bracketed-error-codes]` to human readable messages.
// Keep translation keys as literal t() arguments so the translation updater
// can discover and preserve them.
export function getMachinesErrorMessage(message: string) {
	const code = message.match(/^\[([^\]]+)\]/)?.[1]
	if (!code) return message

	switch (code) {
		case 'machine-image-download-connection-failed':
			return t('machines-error.machine-image-download-connection-failed')
		case 'machine-disk-shrink-not-allowed':
			return t('machines-error.machine-disk-shrink-not-allowed')
		case 'machine-first-boot-setup-in-progress':
			return t('machines-error.machine-first-boot-setup-in-progress')
		case 'machine-install-media-eject-failed':
			return t('machines-error.machine-install-media-eject-failed')
		case 'machine-external-disk-unavailable':
			return t('machines-error.machine-external-disk-unavailable')
		case 'machine-insufficient-storage':
			return t('machines-error.machine-insufficient-storage')
		case 'machine-install-interrupted':
			return t('machines-error.machine-install-interrupted')
		case 'machine-install-retry-credentials-required':
			return t('machines-error.machine-install-retry-credentials-required')
		case 'machine-port-conflict':
			return t('machines-error.machine-port-conflict')
		case 'machine-port-forwards-nat-only':
			return t('machines-error.machine-port-forwards-nat-only')
		case 'machine-lan-bridge-unavailable-wifi':
			return t('machines-error.machine-lan-bridge-unavailable-wifi')
		case 'machine-lan-bridge-unavailable-no-ethernet':
			return t('machines-error.machine-lan-bridge-unavailable-no-ethernet')
		case 'machine-lan-bridge-failed':
			return t('machines-error.machine-lan-bridge-failed')
		case 'machine-shutdown-timeout':
			return t('machines-error.machine-shutdown-timeout')
		case 'machine-start-failed':
			return t('machines-error.machine-start-failed')
		case 'machine-usb-unsupported':
			return t('machines-error.machine-usb-unsupported')
		case 'machine-usb-device-not-found':
			return t('machines-error.machine-usb-device-not-found')
		case 'machine-usb-device-assigned':
			return t('machines-error.machine-usb-device-assigned')
		case 'machine-usb-device-in-use':
			return t('machines-error.machine-usb-device-in-use')
		// Files couldn't eject a drive the machine was given
		case 'failed-unmounts':
			return t('machines-error.failed-unmounts')
		default:
			return message
	}
}

export function useMachineActions() {
	const utils = trpcReact.useUtils()

	const invalidateMachines = () => utils.machines.list.invalidate()

	const onError = (error: {message: string}) => toast.error(getMachinesErrorMessage(error.message), {area: 'machines'})

	const create = trpcReact.machines.create.useMutation({onError, onSettled: invalidateMachines}).mutateAsync
	const retryInstall = trpcReact.machines.retryInstall.useMutation({onError, onSettled: invalidateMachines}).mutate
	const start = trpcReact.machines.start.useMutation({onError, onSettled: invalidateMachines}).mutate
	const stop = trpcReact.machines.stop.useMutation({onError, onSettled: invalidateMachines}).mutate
	const restart = trpcReact.machines.restart.useMutation({onError, onSettled: invalidateMachines}).mutate
	const forceStop = trpcReact.machines.forceStop.useMutation({onError, onSettled: invalidateMachines}).mutate
	const ejectInstallMedia = trpcReact.machines.ejectInstallMedia.useMutation({
		onError,
		onSettled: invalidateMachines,
	}).mutateAsync
	const uninstall = trpcReact.machines.uninstall.useMutation({onError, onSettled: invalidateMachines}).mutateAsync
	const updateSettings = trpcReact.machines.updateSettings.useMutation({
		onError,
		onSettled: invalidateMachines,
	}).mutateAsync
	const setPinned = trpcReact.machines.setPinned.useMutation({onError, onSettled: invalidateMachines}).mutate

	return {
		create,
		retryInstall,
		start,
		stop,
		restart,
		forceStop,
		ejectInstallMedia,
		uninstall,
		updateSettings,
		setPinned,
	}
}
