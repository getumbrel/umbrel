import i18next from 'i18next'
import prettyBytes from 'pretty-bytes'

import {roundForPrettyBytes} from '../../utils/round-for-pretty-bytes.ts'
import type {RaidDevice, RaidStatus, RaidType, StorageDevice} from './hooks/use-storage'

type RaidErrorCounters = Pick<RaidDevice, 'readErrors' | 'writeErrors' | 'checksumErrors'>

export function hasRaidErrors(device?: RaidErrorCounters): boolean {
	return !!device && (device.readErrors > 0 || device.writeErrors > 0 || device.checksumErrors > 0)
}

// In FailSafe, a drive larger than the pool's smallest only contributes that much
export function getSsdCapacity(device: StorageDevice, raidType: RaidType | undefined, minRoundedDriveSize: number) {
	const wastedBytes =
		raidType === 'failsafe' && minRoundedDriveSize > 0 ? Math.max(0, device.roundedSize - minRoundedDriveSize) : 0
	return {wastedBytes, usableSize: wastedBytes > 0 ? minRoundedDriveSize : device.roundedSize}
}

// Status reads can report active work before the progress subscription catches up.
export function hasPoolMutationInProgress(pool: RaidStatus | undefined): boolean {
	return (
		!!pool &&
		(pool.replace?.state === 'rebuilding' ||
			pool.replace?.state === 'expanding' ||
			pool.rebuild?.state === 'rebuilding' ||
			pool.expansion?.state === 'expanding' ||
			!!(pool.failsafeTransitionStatus && !['error', 'complete'].includes(pool.failsafeTransitionStatus.state)))
	)
}

// Physical removal happens before a backend request can protect the user. Only
// offer it when the current topology and detected inventory establish redundancy.
export function canDisconnectPoolMember(
	pool: RaidStatus | undefined,
	id: string | undefined,
	devices: StorageDevice[],
): boolean {
	if (!id || !pool?.exists || pool.raidType !== 'failsafe' || !['ONLINE', 'DEGRADED'].includes(pool.status ?? ''))
		return false
	if (hasPoolMutationInProgress(pool) || pool.scrub?.state === 'scrubbing') return false
	const dataMembers = pool.devices ?? []
	const acceleratorMembers = pool.accelerator?.devices ?? []
	const members = [...dataMembers, ...acceleratorMembers]
	const target = members.find((member) => member.id === id)
	if (!target) return false
	// Repair existing issues before proactively removing a healthy member.
	if (
		target.status === 'ONLINE' &&
		(pool.status !== 'ONLINE' ||
			(pool.dataErrors ?? 0) > 0 ||
			members.some((member) => member.status !== 'ONLINE' || !devices.some((device) => device.id === member.id)))
	)
		return false
	// Old error counts matter while this drive still holds up the pool. ZFS has already
	// stopped using a failed one, so taking it out leaves the others no worse off.
	const isInUse = target.status === 'ONLINE' || target.status === 'DEGRADED'
	return hasHealthyPeers(pool, id, devices, {allowOldErrors: !isInUse})
}

// Whether every other copy of a member's data sits on a working drive
function hasHealthyPeers(
	pool: RaidStatus,
	id: string,
	devices: StorageDevice[],
	{allowOldErrors}: {allowOldErrors: boolean},
): boolean {
	const members = [...(pool.devices ?? []), ...(pool.accelerator?.devices ?? [])]
	const peers = getRedundancyPeers(pool, id)
	return (
		peers.length > 0 &&
		peers.every(
			(otherId) =>
				members.some(
					(member) => member.id === otherId && member.status === 'ONLINE' && (allowOldErrors || !hasRaidErrors(member)),
				) && devices.some((device) => device.id === otherId && device.smartStatus !== 'unhealthy'),
		)
	)
}

// The other drives holding a copy of a member's data: none for a drive with no redundancy
function getRedundancyPeers(pool: RaidStatus, id: string): string[] {
	const dataMembers = pool.devices ?? []
	const acceleratorMembers = pool.accelerator?.devices ?? []
	const group = acceleratorMembers.some((member) => member.id === id)
		? acceleratorMembers.map((member) => member.id)
		: pool.topology === 'raidz'
			? dataMembers.map((member) => member.id)
			: pool.topology === 'mirror'
				? pool.mirrors?.find((pair) => pair.includes(id))
				: undefined
	return [...new Set(group)].filter((otherId) => otherId !== id)
}

// Repairing a member with its own disk erases that disk, so it's only offered when nothing
// depends on it: its data has to live on healthy drives elsewhere, and it has to be a disk ZFS
// has already let go of (a DEGRADED member is still in use) that isn't failing itself. Unlike
// removing a drive, this can be the only way forward, so old error counts on the other
// drives or a scrub umbreld would cancel anyway don't stand in its way.
export function canRepairInPlace(
	pool: RaidStatus | undefined,
	member: {id: string; status?: string},
	devices: StorageDevice[],
): boolean {
	const device = devices.find((candidate) => candidate.id === member.id)
	if (!device || !member.status || member.status === 'ONLINE' || member.status === 'DEGRADED') return false
	if (device.smartStatus === 'unhealthy' || !pool?.exists || hasPoolMutationInProgress(pool)) return false
	return hasHealthyPeers(pool, member.id, devices, {allowOldErrors: true})
}

// The size the pool remembers for a member, which is all that's left of a missing drive.
// umbreld sends it for every member, but its status type doesn't declare it.
export function getRememberedMemberSize(pool: RaidStatus | undefined, id: string | undefined): number | undefined {
	const member = pool?.devices?.find((member) => member.id === id) as {size?: number} | undefined
	return member?.size
}

export function getPoolDeviceType(
	raidStatus: RaidStatus | undefined,
	allDevices: StorageDevice[],
): 'ssd' | 'hdd' | undefined {
	if (!raidStatus?.exists) return undefined

	const poolDeviceIds = new Set(raidStatus.devices?.map((device) => device.id) ?? [])
	const attachedPoolDevice = allDevices.find((device) => device.id && poolDeviceIds.has(device.id))
	if (attachedPoolDevice) return attachedPoolDevice.type

	// Mirror data vdevs and accelerators identify HDD pools even when their physical
	// members are detached. A stripe with no detected members has unknown media.
	if (raidStatus.topology === 'mirror' || raidStatus.accelerator?.exists) return 'hdd'
	if (raidStatus.topology === 'raidz') return 'ssd'
	return undefined
}

// Format bytes without space, rounding to integer only for 3+ digit values (>=100) to avoid overflow
// e.g., "4.5TB", "45.2GB", "256GB" - only 256.1GB gets rounded because 256 >= 100
export const formatStorageSize = (bytes: number) => {
	// First format with 1 decimal to determine the numeric value
	const locale = i18next.language // "4,5TB" in German
	const formatted = prettyBytes(roundForPrettyBytes(bytes), {maximumFractionDigits: 1, locale})
	const numericValue = parseFloat(formatted)

	// If 3+ digits (>=100), round to integer to keep string short
	const fractionDigits = numericValue >= 100 ? 0 : 1

	return prettyBytes(roundForPrettyBytes(bytes), {maximumFractionDigits: fractionDigits, locale}).replace(' ', '')
}

// Pair up unpooled drives for adding to a mirror FailSafe array.
// Greedy largest-with-next-largest pairing always forms pairs when two or more drives are
// attached, even with mismatched sizes (ZFS clamps a mirror to its smaller member). A single
// leftover drive stays unpaired until a partner is attached.
export function planMirrorAdditions(unpooledDrives: StorageDevice[]): {
	pairs: [StorageDevice, StorageDevice][]
	unpaired: StorageDevice[]
} {
	const sorted = [...unpooledDrives].sort((a, b) => b.roundedSize - a.roundedSize)
	const pairs: [StorageDevice, StorageDevice][] = []
	for (; sorted.length >= 2; sorted.splice(0, 2)) pairs.push([sorted[0], sorted[1]])
	return {pairs, unpaired: sorted}
}

// A pool drive matched with the unpooled drive that would mirror it during the
// storage -> failsafe transition. `newDevice` is undefined when no attached drive is
// large enough, in which case the UI asks for a drive of at least `requiredSize`.
export type FailsafeTransitionPairPlan = {
	existingDevice: RaidDevice
	newDevice?: StorageDevice
	requiredSize: number
}

export type FailsafeTransitionPlan = {
	pairs: FailsafeTransitionPairPlan[]
	// Only set when the pool has an accelerator: the SSD that will mirror it (or undefined + required size when missing)
	acceleratorNewDevice?: StorageDevice
	acceleratorRequiredSize?: number
	// True when every pool drive (and the accelerator, if any) has a matched new device
	satisfied: boolean
}

// Plan the storage -> failsafe transition: every pool drive needs a new drive of at least its
// rounded size (backend validates the same rule), and an existing accelerator needs one more SSD.
// Pool drives are matched largest-first, each taking the smallest candidate that fits, which
// minimizes clamped-away space.
export function planFailsafeTransition({
	poolDrives,
	unpooledDrives,
	unpooledSsds,
	acceleratorDevice,
}: {
	poolDrives: RaidDevice[]
	unpooledDrives: StorageDevice[]
	unpooledSsds: StorageDevice[]
	// Physical device backing the existing accelerator, when the pool has one
	acceleratorDevice?: StorageDevice
}): FailsafeTransitionPlan {
	const candidates = [...unpooledDrives].sort((a, b) => a.roundedSize - b.roundedSize)

	const pairs = [...poolDrives]
		.sort((a, b) => b.roundedSize - a.roundedSize)
		.map((existingDevice): FailsafeTransitionPairPlan => {
			const index = candidates.findIndex((candidate) => candidate.roundedSize >= existingDevice.roundedSize)
			const newDevice = index === -1 ? undefined : candidates.splice(index, 1)[0]
			return {existingDevice, newDevice, requiredSize: existingDevice.roundedSize}
		})

	let acceleratorNewDevice: StorageDevice | undefined
	let acceleratorRequiredSize: number | undefined
	if (acceleratorDevice) {
		acceleratorRequiredSize = acceleratorDevice.roundedSize
		acceleratorNewDevice = [...unpooledSsds]
			.sort((a, b) => a.roundedSize - b.roundedSize)
			.find((candidate) => candidate.roundedSize >= acceleratorDevice.roundedSize)
	}

	const satisfied =
		pairs.every((pair) => pair.newDevice !== undefined) && (!acceleratorDevice || acceleratorNewDevice !== undefined)

	return {pairs, acceleratorNewDevice, acceleratorRequiredSize, satisfied}
}

// Standard SSD capacities in GB. The accelerator guidance is ~32x the device's RAM,
// mapped to the smallest standard drive that satisfies it and capped at 4TB:
// 4GB RAM -> 128GB, 8GB -> 256GB ... 128GB+ -> 4TB.
const ssdSizeBucketsGb = [128, 256, 512, 1024, 2048, 4096]
export function recommendedSsdSizeLabel(ramBytes: number) {
	const nominalRamGb = Math.max(1, Math.round(ramBytes / 2 ** 30))
	const sizeGb = ssdSizeBucketsGb.find((bucket) => bucket >= nominalRamGb * 32) ?? ssdSizeBucketsGb.at(-1)!
	return sizeGb >= 1024 ? `${sizeGb / 1024}TB` : `${sizeGb}GB`
}
