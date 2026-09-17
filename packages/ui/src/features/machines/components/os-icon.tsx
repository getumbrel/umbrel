import {getOsVisuals} from '@/features/machines/constants'
import type {MachineState} from '@/features/machines/types'
import {cn} from '@/lib/utils'

// The retro-monitor machine icon sets: one image per display state, served
// from public/ (umbreld's CSP disallows data: URIs, so these must never be
// inlined). Keyed by catalog familyId; custom ISOs plus anything unknown fall
// back to the generic disc set.
const machineIconSets: Record<string, string> = {
	ubuntu: 'machine-ubuntu',
	fedora: 'machine-fedora',
	debian: 'machine-debian',
	alpine: 'machine-alpine',
	android: 'machine-android',
	omarchy: 'machine-omarchy',
	'windows-11': 'machine-windows-11',
	'windows-server': 'machine-windows-server',
	'windows-7': 'machine-windows-7',
	'windows-xp': 'machine-windows-xp',
	'windows-98': 'machine-windows-98',
	'windows-95': 'machine-windows-98',
}
const machineIconSetBase = (osId: string) => `/assets/machines/${machineIconSets[osId] ?? 'machine-custom'}`

export type MachineIconVariant = 'on' | 'loading' | 'off' | 'error'

const variantSuffix: Record<MachineIconVariant, string> = {
	on: '',
	loading: '-loading',
	off: '-off',
	error: '-error',
}

// Resolves the artwork URL for an OS + display state (used directly by
// surfaces that cross-fade between states, e.g. the first-run intro wall)
export const machineIconSrc = (osId: string, variant: MachineIconVariant = 'on') =>
	`${machineIconSetBase(osId)}${variantSuffix[variant]}.webp`

// Exhaustive over MachineState so a new backend state is a compile error
// here rather than silently rendering as powered-on
const stateVariant: Record<MachineState, MachineIconVariant> = {
	installing: 'loading',
	starting: 'loading',
	running: 'on',
	stopping: 'loading',
	restarting: 'loading',
	stopped: 'off',
	suspended: 'off',
	error: 'error',
}

// undefined = no machine yet (OS catalog, new-machine form); `??` guards
// version skew where the backend sends a state this build doesn't know
const variantForState = (state?: MachineState): MachineIconVariant => (state ? (stateVariant[state] ?? 'on') : 'on')

// Renders the machine icon for an OS, reflecting the machine's power state
// when one is provided. Size it via className (e.g. `size-12`).
export function OsIcon({osId, state, className}: {osId: string; state?: MachineState; className?: string}) {
	return (
		<img
			src={machineIconSrc(osId, variantForState(state))}
			alt=''
			className={cn('shrink-0 object-contain', className)}
			draggable={false}
		/>
	)
}

// A soft blurred color glow to place behind an OS icon (matches the Figma
// treatment where each OS card has a blurred copy of the logo behind it)
export function OsIconGlow({osId, className}: {osId: string; className?: string}) {
	const visuals = getOsVisuals(osId)

	return (
		<div
			aria-hidden
			className={cn('pointer-events-none absolute rounded-full opacity-50 blur-2xl', className)}
			style={{backgroundColor: visuals.color}}
		/>
	)
}
