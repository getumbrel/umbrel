import {toast} from '@/components/ui/toast'
import {RouterOutput, trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

// ─── Types ───────────────────────────────────────────────────────────

export type NetworkInterface = RouterOutput['system']['getNetworkInterfaces'][number]

// ─── useNetworkInterfaces ────────────────────────────────────────────

export function useNetworkInterfaces(options?: {refetchInterval?: number; staleTime?: number}) {
	const interfacesQ = trpcReact.system.getNetworkInterfaces.useQuery(undefined, options)

	return {
		interfaces: interfacesQ.data,
		isLoading: interfacesQ.isLoading,
		isError: interfacesQ.isError,
	}
}

// ─── useHostname ─────────────────────────────────────────────────────

export function useHostname({onSuccess}: {onSuccess?: () => void} = {}) {
	const utils = trpcReact.useUtils()
	const hostnameQ = trpcReact.system.getHostname.useQuery()

	const setHostnameMut = trpcReact.system.setHostname.useMutation({
		onSuccess: () => {
			utils.system.getHostname.invalidate()
			onSuccess?.()
		},
		onError: (err) => {
			toast.error(t('network.hostname-change-error', {message: err.message}))
		},
	})

	return {
		hostname: hostnameQ.data ?? 'umbrel',
		setHostname: (hostname: string) => setHostnameMut.mutate({hostname}),
		isPending: setHostnameMut.isPending,
	}
}

// ─── useStaticIp ─────────────────────────────────────────────────────

export const CONFIRMATION_TIMEOUT_SECONDS = 30

export function useStaticIp(mac: string, {onSettled}: {onSettled?: () => void} = {}) {
	const utils = trpcReact.useUtils()

	// Long-running mutation: blocks for up to 30s waiting for confirmStaticIp.
	// Throws if not confirmed (backend auto-reverts).
	const setStaticIpMut = trpcReact.system.setStaticIp.useMutation({
		onError: (err) => {
			// Connection errors are expected during IP changes (interface bounce breaks the
			// WebSocket). Only toast actual backend errors like the 30s timeout revert.
			// Server errors have `data`, network errors don't.
			if (err.data) {
				toast.error(t('network.apply-error', {message: err.message}))
			}
		},
		// Navigate back regardless of outcome. We can't reliably distinguish "succeeded
		// but connection lost" from "failed and reverted" on a dead connection. The
		// interface list data (refreshed by invalidation) tells the user what happened.
		onSettled: () => {
			utils.system.getNetworkInterfaces.invalidate()
			onSettled?.()
		},
	})

	const clearMut = trpcReact.system.clearStaticIp.useMutation({
		onSuccess: () => {
			// Invalidate immediately to reflect the mode change, then again after a delay
			// to pick up the DHCP-assigned IP (DHCP negotiation takes a moment after the
			// interface bounces).
			utils.system.getNetworkInterfaces.invalidate()
			setTimeout(() => utils.system.getNetworkInterfaces.invalidate(), 3000)
		},
		onError: (err) => {
			toast.error(t('network.apply-error', {message: err.message}))
		},
	})

	return {
		setStaticIp: (config: {ip: string; subnetPrefix: number; gateway: string; dns: string[]}) =>
			setStaticIpMut.mutate({mac, ...config}),
		clearStaticIp: () => clearMut.mutate({mac}),
		isSettingStaticIp: setStaticIpMut.isPending,
		isClearing: clearMut.isPending,
	}
}
