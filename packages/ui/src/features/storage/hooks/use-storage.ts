import {RouterOutput, trpcReact} from '@/trpc/trpc'

// Types from backend
export type RaidStatus = RouterOutput['hardware']['raid']['getStatus']
export type StorageDevice = RouterOutput['hardware']['internalStorage']['getDevices'][number]
export type RaidType = 'storage' | 'failsafe'

// RAID device status from ZFS pool
export type RaidDeviceStatus = 'ONLINE' | 'DEGRADED' | 'FAULTED' | 'OFFLINE' | 'UNAVAIL' | 'REMOVED'

// i18n translation keys for RAID device statuses - call t() with these at render time
// t('storage-manager.raid-status.online')
// t('storage-manager.raid-status.degraded')
// t('storage-manager.raid-status.failed')
// t('storage-manager.raid-status.offline')
// t('storage-manager.raid-status.unavailable')
// t('storage-manager.raid-status.removed')
export const raidStatusLabels: Record<RaidDeviceStatus, string> = {
	ONLINE: 'storage-manager.raid-status.online',
	DEGRADED: 'storage-manager.raid-status.degraded',
	FAULTED: 'storage-manager.raid-status.failed',
	OFFLINE: 'storage-manager.raid-status.offline',
	UNAVAIL: 'storage-manager.raid-status.unavailable',
	REMOVED: 'storage-manager.raid-status.removed',
}

// Threshold % for lifetime usage warning (100 = the rated endurance being fully used)
export const LIFETIME_WARNING_THRESHOLD = 80

// Get device health status - single source of truth for all health checks
export function getDeviceHealth(device: StorageDevice) {
	// SMART status
	const smartUnhealthy = device.smartStatus === 'unhealthy'

	// Lifetime remaining (inverse of lifetimeUsed)
	const lifeRemaining = device.lifetimeUsed !== undefined ? Math.max(0, 100 - device.lifetimeUsed) : undefined
	const lifeWarning = device.lifetimeUsed !== undefined && device.lifetimeUsed >= LIFETIME_WARNING_THRESHOLD

	// Temperature checks (critical takes precedence over warning)
	const tempCritical =
		device.temperature !== undefined &&
		device.temperatureCritical !== undefined &&
		device.temperature >= device.temperatureCritical

	const tempWarning =
		!tempCritical &&
		device.temperature !== undefined &&
		device.temperatureWarning !== undefined &&
		device.temperature >= device.temperatureWarning

	// Any warning present
	const hasWarning = smartUnhealthy || lifeWarning || tempWarning || tempCritical

	return {
		hasWarning,
		smartUnhealthy,
		lifeRemaining,
		lifeWarning,
		tempWarning,
		tempCritical,
	}
}

// TODO: remove this after development
// Set to true to use mock devices for dev testing
const USE_MOCK_DEVICES = false

// ============================================================================
// MOCK SCENARIOS - Change MOCK_SCENARIO to test different UI states
// ============================================================================
type MockScenario =
	| 'failsafe-wasted-mixed-sizes' // FailSafe with 4TB+2TB = 2TB wasted (different roundedSize values)
	| 'failsafe-no-waste-same-rounded' // 3x "2TB" drives from different manufacturers = NO wasted (same roundedSize)
	| 'failsafe-adding-same-rounded' // Adding a "2TB" drive with same roundedSize = NO wasted
	| 'storage-can-choose-mode' // Storage mode with 1 drive, 1 ready to add (can choose failsafe)
	| 'storage-can-choose-mode-multi' // Storage mode with 1 drive, 2 ready to add (can choose failsafe)
	| 'storage-can-choose-mode-mismatched' // Storage mode with 2TB, 4TB ready to add (shows wasted in failsafe)
	| 'storage-two-drives' // Storage mode with 2 drives, no available (read-only)
	| 'storage-small-drive' // Storage mode with single small ~256GB drive (layout test)
	| 'failsafe-all-full' // FailSafe with 4 matching drives, all slots full
	| 'failsafe-warnings' // FailSafe with health warnings (temp, life, unhealthy)
	| 'failsafe-empty-slots' // FailSafe with 2 drives, 2 empty slots (no drives detected)
	| 'failsafe-adding-two' // FailSafe with 2 drives, 2 ready to add
	| 'failsafe-degraded' // FailSafe with 3 drives, 1 FAULTED (pool DEGRADED, drive still in slot)
	| 'failsafe-degraded-missing' // FailSafe DEGRADED with drive physically removed (shows warning banner)
	| 'size-validation-swap' // Test swap size validation: 4TB in RAID, only 2TB available
	| 'size-validation-add-failsafe' // Test add size validation: 4TB drives in failsafe, 2TB available
	| 'size-validation-transition' // Test transition size validation: 4TB in storage, 2TB available

// const MOCK_SCENARIO: MockScenario = 'failsafe-wasted-mixed-sizes'
// const MOCK_SCENARIO: MockScenario = 'failsafe-no-waste-same-rounded' // Different actual sizes, same roundedSize = NO waste
// const MOCK_SCENARIO: MockScenario = 'failsafe-adding-same-rounded' // Adding drive with same roundedSize = NO waste
// const MOCK_SCENARIO: MockScenario = 'storage-can-choose-mode'
// const MOCK_SCENARIO: MockScenario = 'storage-can-choose-mode-multi'
// const MOCK_SCENARIO: MockScenario = 'storage-can-choose-mode-mismatched'
// const MOCK_SCENARIO: MockScenario = 'storage-two-drives'
const MOCK_SCENARIO: MockScenario = 'storage-small-drive' // Small ~256GB drive layout test
// const MOCK_SCENARIO: MockScenario = 'failsafe-all-full'
// const MOCK_SCENARIO: MockScenario = 'failsafe-warnings'
// const MOCK_SCENARIO: MockScenario = 'failsafe-empty-slots'
// const MOCK_SCENARIO: MockScenario = 'failsafe-adding-two'
// const MOCK_SCENARIO: MockScenario = 'failsafe-degraded' // Pool DEGRADED with failed drive still in slot
// const MOCK_SCENARIO: MockScenario = 'failsafe-degraded-missing' // Pool DEGRADED with drive physically removed
// const MOCK_SCENARIO: MockScenario = 'size-validation-swap'
// const MOCK_SCENARIO: MockScenario = 'size-validation-add-failsafe'
// const MOCK_SCENARIO: MockScenario = 'size-validation-transition'

// Mock getRoundedDeviceSize matching backend logic (rounds to nearest 250GB for drives ≥1TB)
const getMockRoundedSize = (sizeInBytes: number): number => {
	const oneTerabyte = 1_000_000_000_000
	const twoFiftyGigabytes = 250_000_000_000
	if (sizeInBytes >= oneTerabyte) {
		return Math.floor(sizeInBytes / twoFiftyGigabytes) * twoFiftyGigabytes
	}
	return sizeInBytes
}

// Base device templates
const createDevice = (slot: number, size: number, overrides: Partial<StorageDevice> = {}): StorageDevice => ({
	device: `nvme${slot - 1}n1`,
	id: `nvme-mock-slot-${slot}`,
	pciSlotNumber: slot * 2 + 4,
	name: `Mock SSD ${size / 1e12}TB`,
	model: `Mock SSD ${size / 1e12}TB`,
	serial: `MOCK${slot}${Date.now()}`,
	size,
	roundedSize: getMockRoundedSize(size),
	temperature: 30,
	temperatureWarning: 82,
	temperatureCritical: 85,
	lifetimeUsed: 5,
	smartStatus: 'healthy',
	slot,
	...overrides,
})

const SIZE_2TB = 2000398934016
const SIZE_4TB = 4000787030016

// Scenario definitions
const MOCK_SCENARIOS: Record<MockScenario, {devices: StorageDevice[]; raidStatus: RaidStatus}> = {
	// ============================================================================
	// WASTED SPACE SCENARIOS - Testing roundedSize behavior
	// ============================================================================

	// Scenario: Mixed capacity drives = REAL wasted space
	// 4TB (roundedSize=4TB) + 2TB (roundedSize=2TB) = 2TB wasted
	// The 4TB drive can only contribute 2TB to match the smallest roundedSize
	'failsafe-wasted-mixed-sizes': {
		devices: [
			createDevice(1, SIZE_4TB, {id: 'nvme-slot-1', name: 'Samsung 990 EVO Plus 4TB'}),
			createDevice(3, SIZE_2TB, {id: 'nvme-slot-3', name: 'KINGSTON SNV2S2000G'}),
			createDevice(4, SIZE_2TB, {id: 'nvme-slot-4', name: 'Samsung 990 PRO 2TB'}), // Not in RAID
		],
		raidStatus: {
			name: 'umbrelos-mock',
			exists: true,
			raidType: 'failsafe',
			totalSpace: 4000000000000, // 4TB (normalized raw: 2TB × 2)
			usableSpace: 2000000000000, // 2TB (after parity: 4TB - 2TB)
			usedSpace: 800000000000, // 0.8TB used
			freeSpace: 1200000000000, // 1.2TB free
			status: 'ONLINE',
			devices: [
				{id: 'nvme-slot-1', status: 'ONLINE', readErrors: 0, writeErrors: 0, checksumErrors: 0},
				{id: 'nvme-slot-3', status: 'ONLINE', readErrors: 0, writeErrors: 0, checksumErrors: 0},
			],
		},
	},

	// Scenario: Different manufacturer "2TB" drives with same roundedSize = NO wasted space
	// This demonstrates the key benefit of roundedSize: drives marketed as "2TB" from
	// different manufacturers have different actual sizes but same roundedSize (2TB)
	// Samsung 990 PRO 2TB: 2000398934016 bytes (~2.00TB) → roundedSize: 2TB
	// Samsung 990 EVO Plus 2TB: 2000398934016 bytes (~2.00TB) → roundedSize: 2TB
	// Generic PCIe SSD 2TB: 2048408248320 bytes (~2.05TB) → roundedSize: 2TB (same!)
	'failsafe-no-waste-same-rounded': {
		devices: [
			{
				device: 'nvme0n1',
				id: 'nvme-eui.0025384751a1fd1e',
				pciSlotNumber: 12,
				name: 'Samsung SSD 990 PRO 2TB',
				model: 'Samsung SSD 990 PRO 2TB',
				serial: 'S7HENU0Y732728N',
				size: 2000398934016, // Actual size differs
				roundedSize: 2000000000000, // But rounds to same 2TB
				temperature: 33,
				temperatureWarning: 82,
				temperatureCritical: 85,
				lifetimeUsed: 0,
				smartStatus: 'healthy' as const,
				slot: 1,
			},
			{
				device: 'nvme1n1',
				id: 'nvme-eui.0025385951a0f2ea',
				pciSlotNumber: 14,
				name: 'Samsung SSD 990 EVO Plus 2TB',
				model: 'Samsung SSD 990 EVO Plus 2TB',
				serial: 'S7U7NU0Y940322F',
				size: 2000398934016,
				roundedSize: 2000000000000,
				temperature: 31,
				temperatureWarning: 81,
				temperatureCritical: 85,
				lifetimeUsed: 0,
				smartStatus: 'healthy' as const,
				slot: 2,
			},
			{
				device: 'nvme2n1',
				id: 'nvme-eui.6479a79f9a200921',
				pciSlotNumber: 4,
				name: 'PCIe SSD 2TB',
				model: 'PCIe SSD',
				serial: 'FFA7074C1C1300022334',
				size: 2048408248320, // ~48GB larger actual size
				roundedSize: 2000000000000, // Same roundedSize = no wasted space!
				temperature: 23,
				temperatureWarning: 83,
				temperatureCritical: 85,
				lifetimeUsed: 0,
				smartStatus: 'healthy' as const,
				slot: 3,
			},
		],
		raidStatus: {
			name: 'umbrelos-a380c0fa',
			exists: true,
			raidType: 'failsafe',
			// With roundedSize: 3 × 2TB = 6TB raw, 4TB usable
			totalSpace: 6000000000000,
			usableSpace: 4000000000000,
			usedSpace: 958791680,
			freeSpace: 3999041208320,
			status: 'ONLINE',
			devices: [
				{id: 'nvme-eui.0025384751a1fd1e', status: 'ONLINE', readErrors: 0, writeErrors: 0, checksumErrors: 0},
				{id: 'nvme-eui.0025385951a0f2ea', status: 'ONLINE', readErrors: 0, writeErrors: 0, checksumErrors: 0},
				{id: 'nvme-eui.6479a79f9a200921', status: 'ONLINE', readErrors: 0, writeErrors: 0, checksumErrors: 0},
			],
		},
	},

	// Scenario: Adding a drive with same roundedSize = NO wasted space
	// Demonstrates the Add dialog showing no wasted space when roundedSize matches
	'failsafe-adding-same-rounded': {
		devices: [
			{
				device: 'nvme0n1',
				id: 'nvme-eui.0025384751a1fd1e',
				pciSlotNumber: 12,
				name: 'Samsung SSD 990 PRO 2TB',
				model: 'Samsung SSD 990 PRO 2TB',
				serial: 'S7HENU0Y732728N',
				size: 2000398934016,
				roundedSize: 2000000000000,
				temperature: 33,
				temperatureWarning: 82,
				temperatureCritical: 85,
				lifetimeUsed: 0,
				smartStatus: 'healthy' as const,
				slot: 1,
			},
			{
				device: 'nvme1n1',
				id: 'nvme-eui.0025385951a0f2ea',
				pciSlotNumber: 14,
				name: 'Samsung SSD 990 EVO Plus 2TB',
				model: 'Samsung SSD 990 EVO Plus 2TB',
				serial: 'S7U7NU0Y940322F',
				size: 2000398934016,
				roundedSize: 2000000000000,
				temperature: 31,
				temperatureWarning: 81,
				temperatureCritical: 85,
				lifetimeUsed: 0,
				smartStatus: 'healthy' as const,
				slot: 2,
			},
			{
				device: 'nvme2n1',
				id: 'nvme-eui.6479a79f9a200921',
				pciSlotNumber: 4,
				name: 'PCIe SSD 2TB',
				model: 'PCIe SSD',
				serial: 'FFA7074C1C1300022334',
				size: 2048408248320, // Different actual size but same roundedSize
				roundedSize: 2000000000000, // NOT in RAID yet - will show no wasted in Add dialog
				temperature: 23,
				temperatureWarning: 83,
				temperatureCritical: 85,
				lifetimeUsed: 0,
				smartStatus: 'healthy' as const,
				slot: 3,
			},
		],
		raidStatus: {
			name: 'umbrelos-a380c0fa',
			exists: true,
			raidType: 'failsafe',
			totalSpace: 4000000000000, // 2 × 2TB = 4TB raw
			usableSpace: 2000000000000, // 2TB usable after parity
			usedSpace: 500000000,
			freeSpace: 1999500000000,
			status: 'ONLINE',
			devices: [
				// Only 2 drives in RAID - slot 3 is available to add
				{id: 'nvme-eui.0025384751a1fd1e', status: 'ONLINE', readErrors: 0, writeErrors: 0, checksumErrors: 0},
				{id: 'nvme-eui.0025385951a0f2ea', status: 'ONLINE', readErrors: 0, writeErrors: 0, checksumErrors: 0},
			],
		},
	},

	// ============================================================================
	// STORAGE MODE SCENARIOS
	// ============================================================================

	// Scenario 2: Storage mode with 1 drive, user CAN choose to switch to failsafe
	// 1 drive in RAID (2TB), 1 drive detected but NOT in RAID (2TB in slot 2)
	// Storage mode = no parity, all space is usable
	// User can choose: stay in storage mode OR switch to failsafe when adding
	'storage-can-choose-mode': {
		devices: [
			createDevice(1, SIZE_2TB, {id: 'nvme-slot-1', name: 'Samsung 990 PRO 2TB'}),
			createDevice(2, SIZE_2TB, {id: 'nvme-slot-2', name: 'Samsung 990 PRO 2TB'}), // Not in RAID
		],
		raidStatus: {
			name: 'umbrelos-mock',
			exists: true,
			raidType: 'storage',
			totalSpace: 2000000000000, // 2TB (1 drive)
			usableSpace: 2000000000000, // 2TB (no parity in storage)
			usedSpace: 500000000000, // 0.5TB used
			freeSpace: 1500000000000, // 1.5TB free
			status: 'ONLINE',
			devices: [{id: 'nvme-slot-1', status: 'ONLINE', readErrors: 0, writeErrors: 0, checksumErrors: 0}],
		},
	},

	// Scenario 2b: Storage mode with 1 drive, adding 2 drives (can choose failsafe)
	// 1 drive in RAID (2TB), 2 drives detected but NOT in RAID (2TB each in slots 2, 3)
	// Storage mode = no parity, all space is usable
	// User can choose: stay in storage mode OR switch to failsafe when adding
	'storage-can-choose-mode-multi': {
		devices: [
			createDevice(1, SIZE_2TB, {id: 'nvme-slot-1', name: 'Samsung 990 PRO 2TB'}),
			createDevice(2, SIZE_2TB, {id: 'nvme-slot-2', name: 'Samsung 990 PRO 2TB'}), // Not in RAID
			createDevice(3, SIZE_2TB, {id: 'nvme-slot-3', name: 'Samsung 990 PRO 2TB'}), // Not in RAID
		],
		raidStatus: {
			name: 'umbrelos-mock',
			exists: true,
			raidType: 'storage',
			totalSpace: 2000000000000, // 2TB (1 drive)
			usableSpace: 2000000000000, // 2TB (no parity in storage)
			usedSpace: 500000000000, // 0.5TB used
			freeSpace: 1500000000000, // 1.5TB free
			status: 'ONLINE',
			devices: [{id: 'nvme-slot-1', status: 'ONLINE', readErrors: 0, writeErrors: 0, checksumErrors: 0}],
		},
	},

	// Scenario 2c: Storage mode with 2TB drive, adding 4TB drive (mismatched sizes)
	// 1 drive in RAID (2TB), 1 drive detected but NOT in RAID (4TB in slot 2)
	// Shows wasted space preview when choosing failsafe (4TB limited to 2TB)
	// User can choose: stay in storage (6TB total) OR switch to failsafe (2TB usable, 2TB wasted)
	'storage-can-choose-mode-mismatched': {
		devices: [
			createDevice(1, SIZE_2TB, {id: 'nvme-slot-1', name: 'Samsung 990 PRO 2TB'}),
			createDevice(2, SIZE_4TB, {id: 'nvme-slot-2', name: 'Samsung 990 PRO 4TB'}), // Not in RAID
		],
		raidStatus: {
			name: 'umbrelos-mock',
			exists: true,
			raidType: 'storage',
			totalSpace: 2000000000000, // 2TB (1 drive)
			usableSpace: 2000000000000, // 2TB (no parity in storage)
			usedSpace: 500000000000, // 0.5TB used
			freeSpace: 1500000000000, // 1.5TB free
			status: 'ONLINE',
			devices: [{id: 'nvme-slot-1', status: 'ONLINE', readErrors: 0, writeErrors: 0, checksumErrors: 0}],
		},
	},

	// Scenario 3: Storage mode with 2 drives, no available drives (read-only view)
	// 2 drives in RAID (2TB + 2TB), no drives available to add
	// Storage mode = no parity, all space is usable
	// Cannot switch to failsafe (would need to start fresh)
	'storage-two-drives': {
		devices: [
			createDevice(1, SIZE_2TB, {id: 'nvme-slot-1', name: 'Samsung 990 PRO 2TB'}),
			createDevice(2, SIZE_2TB, {id: 'nvme-slot-2', name: 'Samsung 990 PRO 2TB'}),
		],
		raidStatus: {
			name: 'umbrelos-mock',
			exists: true,
			raidType: 'storage',
			totalSpace: 4000000000000, // 4TB (2 drives)
			usableSpace: 4000000000000, // 4TB (no parity in storage)
			usedSpace: 1200000000000, // 1.2TB used
			freeSpace: 2800000000000, // 2.8TB free
			status: 'ONLINE',
			devices: [
				{id: 'nvme-slot-1', status: 'ONLINE', readErrors: 0, writeErrors: 0, checksumErrors: 0},
				{id: 'nvme-slot-2', status: 'ONLINE', readErrors: 0, writeErrors: 0, checksumErrors: 0},
			],
		},
	},

	// Small drive layout test: Single ~256GB drive in storage mode
	// Tests UI layout with small capacity values
	// Real-world 256GB SSDs are typically ~256,060,514,304 bytes (~256.06GB)
	// Note: drives under 1TB don't get rounded (roundedSize === size)
	'storage-small-drive': {
		devices: [createDevice(1, 256060514304, {id: 'nvme-slot-1', name: 'Samsung 980 PRO 256GB'})],
		raidStatus: {
			name: 'umbrelos-mock',
			exists: true,
			raidType: 'storage',
			totalSpace: 256060514304, // ~256GB
			usableSpace: 256060514304, // ~256GB (no parity in storage)
			usedSpace: 45000000000, // ~45GB used
			freeSpace: 211060514304, // ~211GB free
			status: 'ONLINE',
			devices: [{id: 'nvme-slot-1', status: 'ONLINE', readErrors: 0, writeErrors: 0, checksumErrors: 0}],
		},
	},

	// ============================================================================
	// FAILSAFE MODE SCENARIOS
	// ============================================================================

	// FailSafe with all 4 slots full (no wasted, all same roundedSize)
	// 4 × 2TB drives in RAIDZ1:
	// - totalSpace = 8TB (raw: 2TB × 4)
	// - usableSpace = 6TB (after parity: 8TB - 2TB)
	// - failsafe overhead = 2TB (one drive worth for parity)
	'failsafe-all-full': {
		devices: [
			createDevice(1, SIZE_2TB, {id: 'nvme-slot-1', name: 'Samsung 990 PRO 2TB'}),
			createDevice(2, SIZE_2TB, {id: 'nvme-slot-2', name: 'Samsung 990 PRO 2TB'}),
			createDevice(3, SIZE_2TB, {id: 'nvme-slot-3', name: 'Samsung 990 PRO 2TB'}),
			createDevice(4, SIZE_2TB, {id: 'nvme-slot-4', name: 'Samsung 990 PRO 2TB'}),
		],
		raidStatus: {
			name: 'umbrelos-mock',
			exists: true,
			raidType: 'failsafe',
			totalSpace: 8000000000000, // 8TB (raw: 2TB × 4)
			usableSpace: 6000000000000, // 6TB (after parity: 8TB - 2TB)
			usedSpace: 2000000000000, // 2TB used
			freeSpace: 4000000000000, // 4TB free
			status: 'ONLINE',
			devices: [
				{id: 'nvme-slot-1', status: 'ONLINE', readErrors: 0, writeErrors: 0, checksumErrors: 0},
				{id: 'nvme-slot-2', status: 'ONLINE', readErrors: 0, writeErrors: 0, checksumErrors: 0},
				{id: 'nvme-slot-3', status: 'ONLINE', readErrors: 0, writeErrors: 0, checksumErrors: 0},
				{id: 'nvme-slot-4', status: 'ONLINE', readErrors: 0, writeErrors: 0, checksumErrors: 0},
			],
		},
	},

	// Scenario 5: FailSafe with health warnings
	// 3 × 2TB drives in RAIDZ1:
	// - totalSpace = 6TB (raw: 2TB × 3)
	// - usableSpace = 4TB (after parity: 6TB - 2TB)
	// - failsafe overhead = 2TB
	'failsafe-warnings': {
		devices: [
			createDevice(1, SIZE_2TB, {
				id: 'nvme-slot-1',
				name: 'Samsung 990 PRO 2TB',
			}),
			createDevice(2, SIZE_2TB, {
				id: 'nvme-slot-2',
				name: 'Dying SSD 2TB',
				temperature: 86, // Critical temp!
				temperatureCritical: 85,
				lifetimeUsed: 92, // Low life remaining!
				smartStatus: 'unhealthy', // Unhealthy!
			}),
			createDevice(3, SIZE_2TB, {
				id: 'nvme-slot-3',
				name: 'WD Black SN850X 2TB',
			}),
		],
		raidStatus: {
			name: 'umbrelos-mock',
			exists: true,
			raidType: 'failsafe',
			totalSpace: 6000000000000, // 6TB (raw: 2TB × 3)
			usableSpace: 4000000000000, // 4TB (after parity: 6TB - 2TB)
			usedSpace: 1000000000000, // 1TB used
			freeSpace: 3000000000000, // 3TB free
			status: 'ONLINE',
			devices: [
				{id: 'nvme-slot-1', status: 'ONLINE', readErrors: 0, writeErrors: 0, checksumErrors: 0},
				{id: 'nvme-slot-2', status: 'ONLINE', readErrors: 5, writeErrors: 2, checksumErrors: 1},
				{id: 'nvme-slot-3', status: 'ONLINE', readErrors: 0, writeErrors: 0, checksumErrors: 0},
			],
		},
	},

	// Scenario 6: FailSafe with 2 drives, 2 empty slots (no drives detected)
	// 2 × 2TB drives in RAIDZ1:
	// - totalSpace = 4TB (raw: 2TB × 2)
	// - usableSpace = 2TB (after parity: 4TB - 2TB)
	// - failsafe overhead = 2TB
	'failsafe-empty-slots': {
		devices: [
			createDevice(1, SIZE_2TB, {id: 'nvme-slot-1', name: 'Samsung 990 PRO 2TB'}),
			createDevice(3, SIZE_2TB, {id: 'nvme-slot-3', name: 'Samsung 990 PRO 2TB'}),
			// Slots 2 and 4 are empty - no devices detected
		],
		raidStatus: {
			name: 'umbrelos-mock',
			exists: true,
			raidType: 'failsafe',
			totalSpace: 4000000000000, // 4TB (raw: 2TB × 2)
			usableSpace: 2000000000000, // 2TB (after parity: 4TB - 2TB)
			usedSpace: 600000000000, // 0.6TB used
			freeSpace: 1400000000000, // 1.4TB free
			status: 'ONLINE',
			devices: [
				{id: 'nvme-slot-1', status: 'ONLINE', readErrors: 0, writeErrors: 0, checksumErrors: 0},
				{id: 'nvme-slot-3', status: 'ONLINE', readErrors: 0, writeErrors: 0, checksumErrors: 0},
			],
		},
	},

	// Scenario 7: FailSafe with 2 drives, adding 2 more drives
	// 2 × 2TB drives in RAIDZ1, 2 more 2TB drives detected but NOT in RAID
	// After adding: 4 × 2TB drives in RAIDZ1
	// - totalSpace = 8TB (raw: 2TB × 4)
	// - usableSpace = 6TB (after parity: 8TB - 2TB)
	'failsafe-adding-two': {
		devices: [
			createDevice(1, SIZE_2TB, {id: 'nvme-slot-1', name: 'Samsung 990 PRO 2TB'}),
			createDevice(2, SIZE_2TB, {id: 'nvme-slot-2', name: 'Samsung 990 PRO 2TB'}),
			createDevice(3, SIZE_2TB, {id: 'nvme-slot-3', name: 'Samsung 990 PRO 2TB'}), // Not in RAID
			createDevice(4, SIZE_2TB, {id: 'nvme-slot-4', name: 'Samsung 990 PRO 2TB'}), // Not in RAID
		],
		raidStatus: {
			name: 'umbrelos-mock',
			exists: true,
			raidType: 'failsafe',
			totalSpace: 4000000000000, // 4TB (raw: 2TB × 2)
			usableSpace: 2000000000000, // 2TB (after parity: 4TB - 2TB)
			usedSpace: 800000000000, // 0.8TB used
			freeSpace: 1200000000000, // 1.2TB free
			status: 'ONLINE',
			devices: [
				{id: 'nvme-slot-1', status: 'ONLINE', readErrors: 0, writeErrors: 0, checksumErrors: 0},
				{id: 'nvme-slot-2', status: 'ONLINE', readErrors: 0, writeErrors: 0, checksumErrors: 0},
			],
		},
	},

	// ============================================================================
	// DEGRADED / FAILURE SCENARIOS
	// ============================================================================

	// FailSafe DEGRADED - one drive is failed but still physically present
	// 3 × 2TB drives in RAIDZ1, slot 2 has FAULTED status but drive is still in slot
	// Pool is DEGRADED but still operational (failsafe protecting data)
	// User can see which drive failed and use Swap flow to replace it
	'failsafe-degraded': {
		devices: [
			createDevice(1, SIZE_2TB, {id: 'nvme-slot-1', name: 'Samsung 990 PRO 2TB'}),
			createDevice(2, SIZE_2TB, {id: 'nvme-slot-2', name: 'Samsung 990 PRO 2TB'}), // This one is FAULTED in RAID
			createDevice(3, SIZE_2TB, {id: 'nvme-slot-3', name: 'Samsung 990 PRO 2TB'}),
		],
		raidStatus: {
			name: 'umbrelos-mock',
			exists: true,
			raidType: 'failsafe',
			totalSpace: 6000000000000, // 6TB (raw: 2TB × 3)
			usableSpace: 4000000000000, // 4TB (after parity: 6TB - 2TB)
			usedSpace: 1500000000000, // 1.5TB used
			freeSpace: 2500000000000, // 2.5TB free
			status: 'DEGRADED', // Pool is degraded!
			devices: [
				{id: 'nvme-slot-1', status: 'ONLINE', readErrors: 0, writeErrors: 0, checksumErrors: 0},
				{id: 'nvme-slot-2', status: 'FAULTED', readErrors: 127, writeErrors: 45, checksumErrors: 892}, // Failed drive!
				{id: 'nvme-slot-3', status: 'ONLINE', readErrors: 0, writeErrors: 0, checksumErrors: 0},
			],
		},
	},

	// Scenario 9: FailSafe DEGRADED - drive physically removed/missing
	// Pool thinks it has 3 drives but only 2 are physically present
	// Shows warning banner since we can't identify which slot is affected
	'failsafe-degraded-missing': {
		devices: [
			// Only 2 physical drives - slot 2 drive was removed
			createDevice(1, SIZE_2TB, {id: 'nvme-slot-1', name: 'Samsung 990 PRO 2TB'}),
			createDevice(3, SIZE_2TB, {id: 'nvme-slot-3', name: 'Samsung 990 PRO 2TB'}),
		],
		raidStatus: {
			name: 'umbrelos-mock',
			exists: true,
			raidType: 'failsafe',
			totalSpace: 6000000000000,
			usableSpace: 4000000000000,
			usedSpace: 1500000000000,
			freeSpace: 2500000000000,
			status: 'DEGRADED',
			devices: [
				{id: 'nvme-slot-1', status: 'ONLINE', readErrors: 0, writeErrors: 0, checksumErrors: 0},
				{id: 'nvme-slot-2', status: 'UNAVAIL', readErrors: 0, writeErrors: 0, checksumErrors: 0}, // Missing drive!
				{id: 'nvme-slot-3', status: 'ONLINE', readErrors: 0, writeErrors: 0, checksumErrors: 0},
			],
		},
	},

	// ============================================================================
	// SIZE VALIDATION SCENARIOS - Testing roundedSize constraints
	// ============================================================================

	// Test swap size validation: 4TB drive in storage mode, 2TB available
	// 4TB roundedSize (4TB) vs 2TB roundedSize (2TB) - incompatible
	// Swap dialog should show "No compatible SSDs" warning for the 2TB drive
	'size-validation-swap': {
		devices: [
			createDevice(1, SIZE_4TB, {id: 'nvme-slot-1', name: 'Samsung 990 PRO 4TB'}), // roundedSize: 4TB
			createDevice(2, SIZE_2TB, {id: 'nvme-slot-2', name: 'Samsung 990 PRO 2TB'}), // roundedSize: 2TB - too small!
			createDevice(3, SIZE_4TB, {id: 'nvme-slot-3', name: 'Samsung 990 PRO 4TB'}), // roundedSize: 4TB - valid
		],
		raidStatus: {
			name: 'umbrelos-mock',
			exists: true,
			raidType: 'storage',
			totalSpace: 4000000000000,
			usableSpace: 4000000000000,
			usedSpace: 1000000000000,
			freeSpace: 3000000000000,
			status: 'ONLINE',
			devices: [{id: 'nvme-slot-1', status: 'ONLINE', readErrors: 0, writeErrors: 0, checksumErrors: 0}],
		},
	},

	// Test add to failsafe size validation: 4TB drives in failsafe, 2TB available
	// Existing array has roundedSize 4TB, new drive has roundedSize 2TB - too small!
	// Add dialog should show "SSD too small" warning and disable button
	'size-validation-add-failsafe': {
		devices: [
			createDevice(1, SIZE_4TB, {id: 'nvme-slot-1', name: 'Samsung 990 PRO 4TB'}), // roundedSize: 4TB
			createDevice(2, SIZE_4TB, {id: 'nvme-slot-2', name: 'Samsung 990 PRO 4TB'}), // roundedSize: 4TB
			createDevice(3, SIZE_2TB, {id: 'nvme-slot-3', name: 'Samsung 990 PRO 2TB'}), // roundedSize: 2TB - blocked!
		],
		raidStatus: {
			name: 'umbrelos-mock',
			exists: true,
			raidType: 'failsafe',
			totalSpace: 8000000000000,
			usableSpace: 4000000000000,
			usedSpace: 1000000000000,
			freeSpace: 3000000000000,
			status: 'ONLINE',
			devices: [
				{id: 'nvme-slot-1', status: 'ONLINE', readErrors: 0, writeErrors: 0, checksumErrors: 0},
				{id: 'nvme-slot-2', status: 'ONLINE', readErrors: 0, writeErrors: 0, checksumErrors: 0},
			],
		},
	},

	// Test transition to failsafe size validation: 4TB in storage, 2TB available
	// Current drive has roundedSize 4TB, adding drive with roundedSize 2TB
	// In failsafe, the 2TB drive would set the capacity - but it's smaller than existing!
	// Add dialog with failsafe toggle ON should show "SSD too small" warning
	'size-validation-transition': {
		devices: [
			createDevice(1, SIZE_4TB, {id: 'nvme-slot-1', name: 'Samsung 990 PRO 4TB'}), // roundedSize: 4TB
			createDevice(2, SIZE_2TB, {id: 'nvme-slot-2', name: 'Samsung 990 PRO 2TB'}), // roundedSize: 2TB - blocked!
		],
		raidStatus: {
			name: 'umbrelos-mock',
			exists: true,
			raidType: 'storage',
			totalSpace: 4000000000000,
			usableSpace: 4000000000000,
			usedSpace: 1000000000000,
			freeSpace: 3000000000000,
			status: 'ONLINE',
			devices: [{id: 'nvme-slot-1', status: 'ONLINE', readErrors: 0, writeErrors: 0, checksumErrors: 0}],
		},
	},
}

// Get current mock data based on selected scenario
const getMockData = () => MOCK_SCENARIOS[MOCK_SCENARIO]
const MOCK_DEVICES = getMockData().devices
const MOCK_RAID_STATUS = getMockData().raidStatus

// Device in RAID with merged health info from internal storage
export type RaidDevice = StorageDevice & {
	// From RAID status
	raidStatus: 'ONLINE' | 'DEGRADED' | 'FAULTED' | 'OFFLINE' | 'UNAVAIL' | 'REMOVED'
	readErrors: number
	writeErrors: number
	checksumErrors: number
}

// Hook options
type UseStorageOptions = {
	/** Polling interval in ms for detecting new devices. Set to false to disable polling. */
	pollInterval?: number | false
}

/**
 * Main hook for storage management.
 * Provides RAID status, device info, and mutations for managing storage.
 */
export function useStorage(options: UseStorageOptions = {}) {
	const {pollInterval = false} = options

	// Query: RAID pool status
	const raidStatusQ = trpcReact.hardware.raid.getStatus.useQuery(undefined, {
		refetchInterval: pollInterval,
		enabled: !USE_MOCK_DEVICES,
	})

	// Query: All internal storage devices (NVMe SSDs)
	const devicesQ = trpcReact.hardware.internalStorage.getDevices.useQuery(undefined, {
		refetchInterval: pollInterval,
		enabled: !USE_MOCK_DEVICES,
	})

	// Mutation: Add device to RAID
	const addDeviceMut = trpcReact.hardware.raid.addDevice.useMutation({
		onSuccess: () => {
			// Refetch both queries after adding a device
			raidStatusQ.refetch()
			devicesQ.refetch()
		},
	})

	// Mutation: Transition from single-disk storage to failsafe mode
	const transitionToFailsafeMut = trpcReact.hardware.raid.transitionToFailsafe.useMutation({
		onSuccess: () => {
			raidStatusQ.refetch()
			devicesQ.refetch()
		},
	})

	// Mutation: Replace a device in the RAID array
	const replaceDeviceMut = trpcReact.hardware.raid.replaceDevice.useMutation({
		onSuccess: () => {
			raidStatusQ.refetch()
			devicesQ.refetch()
		},
	})

	// Refetch data when RAID operations complete (non-blocking RPCs return before operation finishes)
	const refetchAll = () => {
		raidStatusQ.refetch()
		devicesQ.refetch()
	}

	trpcReact.eventBus.listen.useSubscription(
		{event: 'raid:expansion-progress'},
		{
			onData(data) {
				const status = data as {state: string}
				if (status.state === 'finished' || status.state === 'canceled') {
					refetchAll()
				}
			},
		},
	)

	trpcReact.eventBus.listen.useSubscription(
		{event: 'raid:rebuild-progress'},
		{
			onData(data) {
				const status = data as {state: string}
				if (status.state === 'finished' || status.state === 'canceled') {
					refetchAll()
				}
			},
		},
	)

	trpcReact.eventBus.listen.useSubscription(
		{event: 'raid:replace-progress'},
		{
			onData(data) {
				const status = data as {state: string}
				if (status.state === 'finished' || status.state === 'canceled') {
					refetchAll()
				}
			},
		},
	)

	trpcReact.eventBus.listen.useSubscription(
		{event: 'raid:failsafe-transition-progress'},
		{
			onData(data) {
				const status = data as {state: string}
				if (status.state === 'complete' || status.state === 'error') {
					refetchAll()
				}
			},
		},
	)

	// Derived: All detected devices
	const allDevices = USE_MOCK_DEVICES ? MOCK_DEVICES : (devicesQ.data ?? [])

	// Derived: RAID status (use mock when in dev mode)
	const raidStatus = USE_MOCK_DEVICES ? MOCK_RAID_STATUS : raidStatusQ.data

	// Derived: Device IDs that are in the RAID
	const raidDeviceIds = new Set(raidStatus?.devices?.map((d) => d.id) ?? [])

	// Derived: RAID devices with merged health info
	const raidDevices: RaidDevice[] = (raidStatus?.devices ?? [])
		.map((raidDevice) => {
			// Find matching device from internal storage for health info
			const storageDevice = allDevices.find((d) => d.id === raidDevice.id)
			if (!storageDevice) return null

			return {
				...storageDevice,
				raidStatus: raidDevice.status,
				readErrors: raidDevice.readErrors,
				writeErrors: raidDevice.writeErrors,
				checksumErrors: raidDevice.checksumErrors,
			}
		})
		.filter((d): d is RaidDevice => d !== null)

	// Derived: Available devices (not in RAID, can be added)
	// TODO: Currently UI is limited to adding 1 SSD at a time due to ZFS raidz1 expansion limitations.
	// When backend supports adding multiple SSDs at once, the UI can show all available devices.
	const availableDevices = allDevices.filter((device) => device.id && !raidDeviceIds.has(device.id))

	// Derived: Loading state
	const isLoading = raidStatusQ.isLoading || devicesQ.isLoading

	// Derived: Error state
	const error = raidStatusQ.error || devicesQ.error

	// --- Chart data calculations ---
	// TODO: Consider adding device sizes directly to raid.getStatus() backend response
	// instead of cross-referencing with internalStorage.getDevices()

	// Get rounded sizes of all RAID devices (backend rounds to nearest 250GB for drives ≥1TB)
	// This eliminates wasted space from manufacturer variance (e.g., Samsung vs Phison "4TB" drives)
	const getRaidDeviceRoundedSizes = (): number[] => {
		if (!raidStatus?.exists || !raidStatus.devices) return []
		return raidStatus.devices
			.map((raidDevice) => {
				const storageDevice = allDevices.find((d) => d.id === raidDevice.id)
				return storageDevice?.roundedSize ?? 0
			})
			.filter((size) => size > 0)
	}

	const raidDeviceRoundedSizes = getRaidDeviceRoundedSizes()
	const minRoundedDriveSize = raidDeviceRoundedSizes.length > 0 ? Math.min(...raidDeviceRoundedSizes) : 0

	// Calculate wasted space in failsafe mode (when drives have different roundedSize values)
	// In RAIDZ1, all drives can only contribute as much as the smallest drive
	// Since backend partitions drives using roundedSize, wasted space only occurs when
	// roundedSize values differ (e.g., mixing 2TB and 4TB drives)
	const calculateWastedSpace = (): number => {
		if (!raidStatus?.exists || raidStatus.raidType !== 'failsafe' || raidDeviceRoundedSizes.length < 2) {
			return 0
		}

		const totalRoundedSize = raidDeviceRoundedSizes.reduce((sum, size) => sum + size, 0)
		const usableRoundedSize = minRoundedDriveSize * raidDeviceRoundedSizes.length
		return Math.max(0, totalRoundedSize - usableRoundedSize)
	}

	// Calculate chart data from RAID status (works with both mock and real data)
	const wastedBytes = calculateWastedSpace()
	const availableBytes = raidStatus?.usableSpace ?? 0
	const failsafeOverheadBytes =
		raidStatus?.raidType === 'failsafe' && raidStatus.totalSpace && raidStatus.usableSpace
			? raidStatus.totalSpace - raidStatus.usableSpace
			: 0
	const totalCapacityBytes = availableBytes + failsafeOverheadBytes + wastedBytes

	// Chart data in TB (for donut chart proportions)
	const chartData = {
		used: raidStatus?.usedSpace ? raidStatus.usedSpace / 1e12 : 0,
		available: availableBytes / 1e12,
		failsafe: failsafeOverheadBytes / 1e12,
		wasted: wastedBytes / 1e12,
	}

	// Total for the chart = available + failsafe + wasted
	const chartTotal = chartData.available + chartData.failsafe + chartData.wasted

	// Derived: Number of drives currently in RAID
	const raidDriveCount = raidStatus?.devices?.length ?? 0

	// Derived: Can user choose between Storage and FailSafe when adding?
	// Only when they have exactly 1 drive in storage mode
	const canChooseMode = raidStatus?.exists && raidStatus.raidType === 'storage' && raidDriveCount === 1

	return {
		// RAID pool info
		raidStatus,
		raidExists: raidStatus?.exists ?? false,
		raidType: raidStatus?.raidType,
		poolStatus: raidStatus?.status,

		// Space info (raw bytes) for display with formatStorageSize
		usedSpace: raidStatus?.usedSpace,
		availableBytes,
		failsafeOverheadBytes,
		wastedBytes,
		totalCapacityBytes,

		// Chart data (in TB, for donut chart proportions)
		chartData: {
			...chartData,
			total: chartTotal,
		},

		// Per-drive wasted calculation (for failsafe mode with mismatched drives)
		// In failsafe mode, each drive can only contribute up to the smallest rounded size
		minRoundedDriveSize,

		// Devices
		allDevices,
		raidDevices,
		raidDriveCount,
		availableDevices,
		// Map devices to 4 slots (Umbrel Pro has 4 SSD slots)
		ssdSlots: Array.from({length: 4}, (_, i) => allDevices.find((d) => d.slot === i + 1) ?? null),
		// Set of device IDs that are detected but not in RAID (ready to add)
		readyToAddIds: new Set(availableDevices.map((d) => d.id)),

		// Mode selection
		// True when user has exactly 1 drive in storage mode and is adding more
		// In this case they can choose to stay in storage or switch to failsafe
		canChooseMode,

		// State
		isLoading,
		error,

		// Mutations
		addDevice: addDeviceMut.mutate,
		addDeviceAsync: addDeviceMut.mutateAsync,
		isAddingDevice: addDeviceMut.isPending,
		addDeviceError: addDeviceMut.error,

		transitionToFailsafe: transitionToFailsafeMut.mutate,
		transitionToFailsafeAsync: transitionToFailsafeMut.mutateAsync,
		isTransitioning: transitionToFailsafeMut.isPending,
		transitionError: transitionToFailsafeMut.error,

		replaceDevice: replaceDeviceMut.mutate,
		replaceDeviceAsync: replaceDeviceMut.mutateAsync,
		isReplacingDevice: replaceDeviceMut.isPending,
		replaceDeviceError: replaceDeviceMut.error,

		// Refetch
		refetch: () => {
			raidStatusQ.refetch()
			devicesQ.refetch()
		},
	}
}
