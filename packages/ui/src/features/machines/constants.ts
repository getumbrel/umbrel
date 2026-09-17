import {cn} from '@/lib/utils'
import {tw} from '@/utils/tw'

export const MACHINES_PATH = '/machines'
export const MACHINES_ADD_PATH = '/machines/new'
export const MACHINES_CONFIGURE_PATH = '/machines/new/configure'

export const machinePath = (machineId: string) => `${MACHINES_PATH}/${machineId}`
export const machineFullscreenPath = (machineId: string) => `${MACHINES_PATH}/${machineId}/fullscreen`

// Shared timing for the layout morph between views (container resize and the
// header/tab bar position shifts all move in lockstep) — now shared with other
// features, re-exported here for the existing machines imports
export {layoutMorphTransition} from '@/components/ui/shared/motion'

export const MAX_DISK_SIZE_GB = 10_000
export const MIN_MEMORY_GB = 1

// Fallback specs for sources we know nothing about: custom installer ISOs and
// preinstalled disk images. Catalog images get a real profile below.
export const DEFAULT_DISK_SIZE_GB = 40
export const DEFAULT_CORES = 2
export const DEFAULT_MEMORY_GB = 4

// Core options are dynamic: 1 up to the host's thread count (system.cpuUsage.threads)
export const coreOptions = (threads: number | undefined) =>
	Array.from({length: Math.max(1, threads ?? DEFAULT_CORES)}, (_, i) => i + 1)

// ─────────────────────────────────────────────────────────────────────────────
// Per-OS spec profiles
//
// We used to seed every machine with a flat 4 cores / 4 GB / 100 GB regardless
// of what was being installed. That is wrong in both directions: 100 GB is ~100x
// what Alpine needs (and the backend's free-space check counts the *full*
// requested size, so it fails creation on hosts that could run the VM easily),
// while 4 GB is below Ubuntu 26.04 Desktop's official 6 GB minimum.
//
// `defaults` below are what we prefill; `min` is the floor we won't let the form
// go under. We use requirements for the exact catalog media where vendors
// publish them. Broad recommendations inform defaults rather than being
// mislabeled as hard installation floors.
// Sources, per family:
//   Ubuntu 26.04    desktop 6 GB / 25 GB, server floor 1.5 GB / 4 GB
//                   documentation.ubuntu.com/release-notes/26.04
//   Fedora 44       Fedora recommends 4 GB / 40 GB for "most variants" and says
//                   doubling that may improve the experience. The Desktop
//                   default meets that guidance; the lower floors and Server
//                   defaults reflect our lighter Cloud Base catalog image.
//                   fedoraproject.org/workstation/download
//   Debian 13       desktop 1 GB min / 2 GB rec + 10 GB; server 512 MB min /
//                   1 GB rec + 4 GB — the only project publishing both columns
//                   debian.org/releases/stable/amd64/ch03s04.en.html
//   Alpine 3.24     128 MB boot / 320 MB install (256/512 on aarch64), ~1 GB disk
//                   wiki.alpinelinux.org/wiki/Requirements
//   Android 13      Waydroid publishes nothing; these cover the Ubuntu host plus
//                   the ~16 GB Android system/vendor images
//   Omarchy 4       Conservative VM budgets for the full desktop; upstream does
//                   not publish installation minimums (omarchy.org).
//   Windows 11      2 vCPU / 4 GB / 64 GB, incl. an explicit VM section. We
//                   default to 96 GB because a feature update on a 64 GB disk
//                   runs out of servicing headroom
//                   learn.microsoft.com/windows/whats-new/windows-11-requirements
//   Win Server 2025 2 GB min / 4 GB rec, 32 GB "absolute minimum"; MS declines to
//                   publish recommended CPU/storage
//                   learn.microsoft.com/windows-server/get-started/hardware-requirements
//   Windows 7/XP/98 vendor minimums. Our Windows 7 ISO is x64 (2 GB / 20 GB),
//                   while XP and 98 are 32-bit media. The platformProfile names
//                   describe QEMU compatibility, not ISO bitness. 98 is
//                   single-CPU and its memory is pinned by the catalog's
//                   fixedMemoryMb (512 MB) regardless of what we ask for.
//
// TODO(backend): the per-OS floors are not enforced anywhere but here. `machines.create`
// takes diskSizeGb/cores/memoryGb as required inputs with only blanket bounds
// (1-10000 GB / 1-64 cores / 1-1024 GB) and no defaults, so any non-UI caller
// can create a Windows 11 machine with 1 core, 1 GB of RAM and a 1 GB disk that
// cannot possibly install. These profiles belong on the catalog entries in
// umbreld (next to the existing fixedMemoryMb / estimatedInstalledSizeMb) so the
// backend can (a) default the fields when omitted, (b) reject anything below the
// per-OS minimum.
// ─────────────────────────────────────────────────────────────────────────────

export type MachineSpecProfile = {
	cores: number
	memoryGb: number
	diskSizeGb: number
	minCores: number
	minMemoryGb: number
	minDiskSizeGb: number
}

const specProfile = (
	cores: number,
	memoryGb: number,
	diskSizeGb: number,
	minCores: number,
	minMemoryGb: number,
	minDiskSizeGb: number,
): MachineSpecProfile => ({cores, memoryGb, diskSizeGb, minCores, minMemoryGb, minDiskSizeGb})

export const fallbackSpecProfile = specProfile(DEFAULT_CORES, DEFAULT_MEMORY_GB, DEFAULT_DISK_SIZE_GB, 1, 1, 1)

// Keyed by `familyId` or `familyId:variantName` (the more specific key wins), so
// both architectures of an image share one profile.
//                                                    cores  mem  disk   min: cores  mem  disk
const machineSpecProfiles: Record<string, MachineSpecProfile> = {
	'ubuntu:Desktop': specProfile(4, 8, 40, 2, 6, 25),
	'ubuntu:Server': specProfile(2, 2, 20, 1, 1, 5),
	'fedora:Desktop': specProfile(4, 8, 40, 2, 4, 25),
	'fedora:Server': specProfile(2, 2, 20, 1, 1, 5),
	'debian:Desktop': specProfile(2, 4, 25, 1, 1, 10),
	'debian:Server': specProfile(2, 2, 15, 1, 1, 4),
	alpine: specProfile(2, 1, 8, 1, 1, 2),
	android: specProfile(4, 8, 40, 2, 4, 25),
	omarchy: specProfile(4, 8, 40, 2, 4, 25),
	'windows-11': specProfile(4, 8, 96, 2, 4, 64),
	'windows-server': specProfile(4, 8, 80, 2, 4, 32),
	'windows-7': specProfile(2, 2, 40, 1, 2, 20),
	'windows-xp': specProfile(1, 1, 20, 1, 1, 2),
	'windows-98': specProfile(1, 1, 2, 1, 1, 1),
}

export const getMachineSpecProfile = (osImage?: {familyId?: string; variantName?: string; custom?: boolean}) => {
	if (!osImage || osImage.custom || !osImage.familyId) return fallbackSpecProfile
	return (
		machineSpecProfiles[`${osImage.familyId}:${osImage.variantName}`] ??
		machineSpecProfiles[osImage.familyId] ??
		fallbackSpecProfile
	)
}

// Preserve the existing Machines UI ceiling: reserve the larger of 2 GB or
// whatever the host is currently using.
export const hostReservedMemoryBytes = (memory?: {size: number; totalUsed: number}) =>
	Math.max(2e9, memory?.totalUsed ?? 0)

// Default cores are capped at half the host's threads so a new machine never
// claims the whole CPU by default. The user can still dial it up to `threads`.
export const recommendedCores = (profile: MachineSpecProfile, threads: number | undefined) => {
	const half = threads ? Math.max(1, Math.floor(threads / 2)) : profile.cores
	return Math.max(profile.minCores, Math.min(profile.cores, Math.max(half, profile.minCores)))
}

// A flat 25 GB step is unusable on an 8 GB Alpine disk, so scale it to the value
export const diskStepGb = (value: number) => (value < 10 ? 1 : value < 100 ? 5 : 25)

type OsVisuals = {
	// Brand color used for logo glows and the mock desktop wallpaper
	color: string
}

// Brand colors for the popular OS catalog, keyed by familyId. Artwork lives in
// the machineIconSets map (os-icon.tsx) — keep the two key sets in sync.
export const osVisuals: Record<string, OsVisuals> = {
	ubuntu: {color: '#E95420'},
	fedora: {color: '#3C6EB4'},
	debian: {color: '#D70A53'},
	alpine: {color: '#0D597F'},
	android: {color: '#3DDC84'},
	omarchy: {color: '#9ECE6A'},
	'windows-11': {color: '#0078D4'},
	'windows-server': {color: '#0078D4'},
	'windows-7': {color: '#00ADEF'},
	'windows-xp': {color: '#7FBA00'},
	'windows-95': {color: '#008080'},
	'windows-98': {color: '#008080'},
}

export const customOsVisuals: OsVisuals = {color: '#8f8f8f'}

export const getOsVisuals = (osId: string): OsVisuals => osVisuals[osId] ?? customOsVisuals

// Machine control buttons (power / stop / restart / menu), per surface.
// Arbitrary-value classes stay literal so Tailwind can see them at build time.
const machineControlButtonClass = tw`flex shrink-0 items-center justify-center rounded-full text-white transition-[background-color,transform] duration-200 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-white/20 active:scale-90 disabled:pointer-events-none`

// List rows: borderless with a whisper of surface, so controls read as part
// of the card rather than dark knobs sitting on it
export const machineRowButtonClass = cn(
	machineControlButtonClass,
	tw`size-10 bg-white/6 hover:bg-white/12 disabled:opacity-50`,
)

// Machine view rail: fixed 48px, same minimal surface as the row buttons plus
// the settings-card edge material, whose inset top shine separates the
// floating buttons from the dark canvas behind them
export const machineRailButtonClass = cn(
	machineControlButtonClass,
	tw`settings-edge-material size-12 bg-white/6 hover:bg-white/12 disabled:opacity-40`,
)

// Repeated feature color: stop/error red (#f63636). Arbitrary-value Tailwind
// classes must be literal at build time, so we hoist the whole class string
// rather than interpolating the hex into a className.
export const machineStopTextClass = tw`text-[#f63636]`
