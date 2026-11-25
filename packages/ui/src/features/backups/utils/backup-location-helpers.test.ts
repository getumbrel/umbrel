// @vitest-environment jsdom

import {describe, expect, test} from 'vitest'

import {describeBackupLocation} from './backup-location-helpers'

// A drive labelled "Clé 64 Go" and a share named "Sauvegardé", as umbreld
// reports them: mount paths have lost the accented letters
const disks = [
	{
		id: 'sda',
		name: 'SanDisk Ultra',
		transport: 'usb' as const,
		size: 61_500_000_000,
		isMounted: true,
		isFormatting: false,
		partitions: [
			{
				id: 'sda1',
				type: 'Microsoft basic data',
				label: 'Clé 64 Go',
				filesystemUuid: '6E0A-1C2F',
				size: 61_500_000_000,
				mountpoints: ['/External/Cl 64 Go'],
				supportsAppDataRoot: false,
			},
		],
	},
]
const shares = [{host: 'nas.local', share: 'Sauvegardé', mountPath: '/Network/nas.local/Sauvegard', isMounted: true}]

describe('describeBackupLocation', () => {
	test('names a drive by its label', () => {
		expect(describeBackupLocation('/External/Cl 64 Go/Backups/Umbrel Backup.backup', {disks, shares})).toEqual({
			name: 'Clé 64 Go',
			folder: '/Backups',
			path: 'Clé 64 Go/Backups/',
		})
	})

	test('names a NAS by its host and share', () => {
		expect(describeBackupLocation('/Network/nas.local/Sauvegard/Umbrel/Umbrel Backup.backup', {disks, shares})).toEqual(
			{
				name: 'nas.local',
				folder: '/Sauvegardé/Umbrel',
				path: 'nas.local/Sauvegardé/Umbrel/',
			},
		)
	})

	test('describes a folder that has no backup in it yet', () => {
		expect(describeBackupLocation('/External/Cl 64 Go', {disks, shares})).toEqual({
			name: 'Clé 64 Go',
			folder: '/',
			path: 'Clé 64 Go/',
		})
	})

	test('falls back to the names in the path while the drive or share is unknown', () => {
		expect(describeBackupLocation('/External/Cl 64 Go/Backups/Umbrel Backup.backup')).toEqual({
			name: 'Cl 64 Go',
			folder: '/Backups',
			path: 'Cl 64 Go/Backups/',
		})
		expect(describeBackupLocation('/Network/nas.local/Sauvegard/Umbrel Backup.backup', {disks, shares: []})).toEqual({
			name: 'nas.local',
			folder: '/Sauvegard',
			path: 'nas.local/Sauvegard/',
		})
	})

	test('names a NAS on its own, where its shares are mounted', () => {
		const shares = [{host: 'fd00::12', share: 'Backups', mountPath: '/Network/fd0012/Backups', isMounted: true}]
		expect(describeBackupLocation('/Network/fd0012', {shares}).name).toBe('fd00::12')
	})

	test('leaves a drive mounted beside it alone', () => {
		expect(describeBackupLocation('/External/Cl 64 Go (2)/Umbrel Backup.backup', {disks, shares}).name).toBe(
			'Cl 64 Go (2)',
		)
	})
})
