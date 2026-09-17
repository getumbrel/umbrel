import {createElement, useEffect, useMemo, useRef} from 'react'
import {useNavigate} from 'react-router-dom'

import {toast} from '@/components/ui/toast'
import {machineIconSrc} from '@/features/machines/components/os-icon'
import {machinePath} from '@/features/machines/constants'
import type {Machine, MachineAgentControl, OsImage} from '@/features/machines/types'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

// Live-updates the machines and OS image query caches from event bus snapshots.
// The authenticated desktop mounts one owner-only listener globally; the
// standalone fullscreen console mounts its own because it sits outside that tree.
export function useMachinesLiveUpdates({enabled = true}: {enabled?: boolean} = {}) {
	const utils = trpcReact.useUtils()

	trpcReact.eventBus.listen.useSubscription(
		{event: 'machines:updated'},
		{
			enabled,
			// Refetch on every (re)connect so a dropped websocket can't leave the
			// progress UI frozen on a stale snapshot (onStarted fires on reconnect too)
			onStarted: () => utils.machines.list.invalidate(),
			onData: (data) => utils.machines.list.setData(undefined, data as Machine[]),
			onError: (error) => console.error('machines:updated subscription error', error),
		},
	)

	trpcReact.eventBus.listen.useSubscription(
		{event: 'machines:os-images-updated'},
		{
			enabled,
			onStarted: () => utils.machines.osImages.invalidate(),
			onData: (data) => utils.machines.osImages.setData(undefined, data as OsImage[]),
			onError: (error) => console.error('machines:os-images-updated subscription error', error),
		},
	)
}

export function useMachines({enabled = true}: {enabled?: boolean} = {}) {
	const machinesQ = trpcReact.machines.list.useQuery(undefined, {
		enabled,
		staleTime: 5_000,
		retry: false,
	})

	return {
		machines: machinesQ.data ?? [],
		isLoading: machinesQ.isLoading,
		isError: machinesQ.isError,
		refetch: machinesQ.refetch,
	}
}

export function useMachine(machineId?: string, {enabled = true}: {enabled?: boolean} = {}) {
	const {machines, isLoading} = useMachines({enabled})

	return {
		machine: machineId ? machines.find((machine) => machine.id === machineId) : undefined,
		isLoading,
	}
}

export function useOsImages() {
	const osImagesQ = trpcReact.machines.osImages.useQuery(undefined, {
		staleTime: 5_000,
		retry: false,
	})

	return {
		osImages: osImagesQ.data ?? [],
		isLoading: osImagesQ.isLoading,
		isError: osImagesQ.isError,
		refetch: osImagesQ.refetch,
	}
}

// Which machines an MCP agent is driving right now, kept live from the
// agent-control events so the console can show who is at the controls and
// follow their pointer. Mounted by the console itself, so at most a couple of
// subscriptions exist at once.
export function useMachineAgentControls({
	enabled = true,
	onArrival,
}: {enabled?: boolean; onArrival?: (machineId: string, tokenId: string) => void} = {}) {
	const utils = trpcReact.useUtils()
	const query = trpcReact.machines.agentControls.useQuery(undefined, {enabled, staleTime: 5_000, retry: false})

	trpcReact.eventBus.listen.useSubscription(
		{event: 'machines:agent-control'},
		{
			enabled,
			onStarted: () => utils.machines.agentControls.invalidate(),
			onData: (data) => {
				const event = data as {machineId: string; control: MachineAgentControl | null}
				// An older in-flight snapshot must not overwrite a press/release event.
				const previous = utils.machines.agentControls.getData()
				if (previous && !previous[event.machineId] && event.control && !document.hidden)
					onArrival?.(event.machineId, event.control.agent.tokenId)
				void utils.machines.agentControls.cancel()
				utils.machines.agentControls.setData(undefined, (current) => {
					const next = {...(current ?? {})}
					if (event.control) next[event.machineId] = event.control
					else delete next[event.machineId]
					return next
				})
			},
			onError: (error) => console.error('machines:agent-control subscription error', error),
		},
	)

	return query.data ?? {}
}

export function useMachineCapabilities() {
	const query = trpcReact.machines.capabilities.useQuery(undefined, {staleTime: Infinity, retry: false})
	return {capabilities: query.data, isLoading: query.isLoading}
}

// Machines currently installing. Freshness comes from the single global
// owner-only listener mounted next to this hook by FloatingIslandContainer.
export function useInstallingMachines({enabled = true}: {enabled?: boolean} = {}) {
	const {machines} = useMachines({enabled})
	return useMemo(
		() =>
			machines.filter(
				(machine) =>
					machine.installationState &&
					machine.installationState !== 'ready-for-setup' &&
					machine.installationState !== 'setup-delayed',
			),
		[machines],
	)
}

// Announces the real end of an install lifecycle. Automated installs only
// succeed after their authenticated guest callback; manual installers stop at
// "ready for setup" instead of claiming that the guest OS is already installed.
// Mount once globally, alongside a live-updates subscription for freshness
// (FloatingIslandContainer mounts it next to useInstallingMachines).
export function useMachineInstallToasts({enabled = true}: {enabled?: boolean} = {}) {
	const navigate = useNavigate()
	const {machines} = useMachines({enabled})
	// Machines observed mid-install, waiting to complete
	const pendingRef = useRef(new Set<string>())
	// Delayed notifications already shown during this app session
	const delayedRef = useRef(new Set<string>())

	useEffect(() => {
		const pending = pendingRef.current
		const delayed = delayedRef.current
		for (const machine of machines) {
			if (machine.installationState && machine.installationState !== 'ready-for-setup') {
				pending.add(machine.id)
				if (machine.installationState === 'setup-delayed' && machine.state === 'running' && !delayed.has(machine.id)) {
					delayed.add(machine.id)
					toast.info(t('machines.setup-taking-longer'), {
						icon: createElement('img', {
							src: machineIconSrc(machine.osId),
							alt: '',
							className: 'size-10 shrink-0 object-contain',
						}),
						duration: 5_000,
						action: {label: t('machines.view'), onClick: () => navigate(machinePath(machine.id))},
					})
				}
				continue
			}
			delayed.delete(machine.id)
			if (!pending.has(machine.id)) continue
			pending.delete(machine.id)
			// Failed installs surface through the machine's own error UI
			if (machine.state === 'error') continue
			// A non-running terminal state is not a completed install.
			if (machine.installationState !== 'ready-for-setup' && machine.state !== 'running') continue
			const message =
				machine.installationState === 'ready-for-setup'
					? t('machines.machine-ready-for-setup', {name: machine.name})
					: t('machines.machine-ready', {name: machine.name})
			const notify = machine.installationState === 'ready-for-setup' ? toast.info : toast.success
			notify(message, {
				// The installed OS's own monitor artwork instead of the area icon
				// (createElement: this hooks file is .ts, not .tsx)
				icon: createElement('img', {
					src: machineIconSrc(machine.osId),
					alt: '',
					className: 'size-10 shrink-0 object-contain',
				}),
				duration: 5_000,
				action: {label: t('machines.view'), onClick: () => navigate(machinePath(machine.id))},
			})
		}
		// Cancelled installs and uninstalled machines just stop appearing
		const ids = new Set(machines.map((machine) => machine.id))
		for (const id of pending) if (!ids.has(id)) pending.delete(id)
		for (const id of delayed) if (!ids.has(id)) delayed.delete(id)
	}, [machines, navigate])
}
