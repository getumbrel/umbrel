import {describe, expect, test} from 'vitest'

import {
	getNewUserAccessDefaults,
	isCoveredByHomeShare,
	isStorageCategoryPath,
	planNewUserAccessChanges,
	removeUserFromSharedWith,
} from './new-user-access'

describe('new user access', () => {
	test('preselects only shares that future members inherit', () => {
		expect(
			getNewUserAccessDefaults(
				[
					{appId: '*', sharedWith: 'all'},
					{appId: 'files', sharedWith: 'all'},
					{appId: 'notes', sharedWith: ['member-1']},
				],
				[
					{path: '/Home', sharedWith: 'all'},
					{path: '/External', sharedWith: ['member-1']},
					{path: '/Network', sharedWith: ['member-1']},
				],
			),
		).toEqual({
			inheritedAppIds: ['*', 'files'],
			inheritedFolderPaths: ['/Home'],
			pickedAppIds: ['files'],
			pickedFolderPaths: [],
			shareAllApps: true,
			shareHome: true,
		})
	})

	test('converts removed inherited shares and adds newly selected shares', () => {
		expect(
			planNewUserAccessChanges({
				inheritedAppIds: ['files', 'notes'],
				inheritedFolderPaths: ['/Home/photos', '/External'],
				pickedAppIds: ['files', 'calendar'],
				pickedFolderPaths: ['/Home/music'],
				shareAllApps: false,
				shareHome: false,
				allowExternalStorage: false,
				allowNetworkStorage: true,
			}),
		).toEqual({
			appIdsToAdd: ['files', 'calendar'],
			appIdsToRemove: ['notes'],
			folderPathsToAdd: ['/Home/music', '/Network'],
			folderPathsToRemove: ['/Home/photos', '/External'],
		})
	})

	test('Home sharing covers Home descendants without affecting storage category grants', () => {
		expect(
			planNewUserAccessChanges({
				inheritedAppIds: [],
				inheritedFolderPaths: ['/Home/photos', '/External'],
				pickedAppIds: [],
				pickedFolderPaths: ['/Home/photos'],
				shareAllApps: false,
				shareHome: true,
				allowExternalStorage: true,
				allowNetworkStorage: false,
			}),
		).toEqual({
			appIdsToAdd: [],
			appIdsToRemove: [],
			folderPathsToAdd: ['/Home', '/External'],
			folderPathsToRemove: [],
		})
		expect(isCoveredByHomeShare('/Home/photos')).toBe(true)
		expect(isCoveredByHomeShare('/External/photos')).toBe(false)
		expect(isStorageCategoryPath('/External')).toBe(true)
		expect(isStorageCategoryPath('/Network')).toBe(true)
		expect(isStorageCategoryPath('/External/photos')).toBe(false)
	})

	test('turning off wildcard access converts the wildcard share', () => {
		expect(
			planNewUserAccessChanges({
				inheritedAppIds: ['*', 'files'],
				inheritedFolderPaths: ['/Home'],
				pickedAppIds: ['files'],
				pickedFolderPaths: [],
				shareAllApps: false,
				shareHome: false,
				allowExternalStorage: false,
				allowNetworkStorage: false,
			}),
		).toEqual({
			appIdsToAdd: ['files'],
			appIdsToRemove: ['*'],
			folderPathsToAdd: [],
			folderPathsToRemove: ['/Home'],
		})
	})

	test('leaves inherited individual grants alone while wildcard access is selected', () => {
		expect(
			planNewUserAccessChanges({
				inheritedAppIds: ['*', 'files'],
				inheritedFolderPaths: [],
				pickedAppIds: [],
				pickedFolderPaths: [],
				shareAllApps: true,
				shareHome: false,
				allowExternalStorage: false,
				allowNetworkStorage: false,
			}),
		).toMatchObject({appIdsToAdd: ['*'], appIdsToRemove: []})
	})

	test('converts everyone to existing members, or removes the share when there are none', () => {
		expect(removeUserFromSharedWith('all', 'new-member', ['member-1', 'member-2'])).toEqual(['member-1', 'member-2'])
		expect(removeUserFromSharedWith('all', 'new-member', [])).toEqual([])
	})

	test('treats RAID as a storage category like external and network', () => {
		expect(isStorageCategoryPath('/Raid')).toBe(true)
		expect(isStorageCategoryPath('/Raid/umbrel-md')).toBe(false)

		// Granting RAID storage adds the category root, and revoking removes it
		expect(
			planNewUserAccessChanges({
				inheritedAppIds: [],
				inheritedFolderPaths: ['/Raid'],
				pickedAppIds: [],
				pickedFolderPaths: [],
				shareAllApps: false,
				shareHome: false,
				allowExternalStorage: false,
				allowNetworkStorage: false,
				allowRaidStorage: true,
			}),
		).toMatchObject({folderPathsToAdd: ['/Raid'], folderPathsToRemove: []})

		expect(
			planNewUserAccessChanges({
				inheritedAppIds: [],
				inheritedFolderPaths: ['/Raid'],
				pickedAppIds: [],
				pickedFolderPaths: [],
				shareAllApps: false,
				shareHome: false,
				allowExternalStorage: false,
				allowNetworkStorage: false,
				allowRaidStorage: false,
			}),
		).toMatchObject({folderPathsToAdd: [], folderPathsToRemove: ['/Raid']})
	})
})
