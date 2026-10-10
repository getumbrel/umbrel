import nodePath from 'node:path'

import z from 'zod'

import {accountAvatarUrl} from '../user/avatar-api.js'
import {OWNER_USER_ID} from '../user/constants.js'

import {
	router,
	privateProcedure,
	privateProcedureWithMembers,
	publicProcedureWhenNoUserExists,
	publicProcedureWhenNoUserExistsWithMembers,
} from '../server/trpc/trpc.js'
import {CLOUD_SYNC_MODE_IDS, CLOUD_WEBDAV_FLAVOR_IDS} from './cloud-types.js'
import {supportsAppDataRootFilesystem} from './external-storage.js'
import {getDirectoryStream} from './files.js'

// Numeric collation matches the Files UI. Distinct names can collate equally
// (for example 1.txt and 01.txt), so use the raw name as a tie-breaker to make
// cursor pagination a total, stable order.
const fileNameCollator = new Intl.Collator('en-US', {numeric: true})

function compareFileNames(first: string, second: string) {
	return fileNameCollator.compare(first, second) || (first < second ? -1 : first > second ? 1 : 0)
}

const accountId = z.string().uuid()
const sambaPassword = z
	.string()
	.min(6, 'Password must be at least 6 characters')
	.max(127, 'Password must be at most 127 characters')
	.refine((password) => !/[\r\n\0]/.test(password), 'Password contains unsupported characters')
const oauthProvider = z.enum(['google-drive', 'dropbox', 'onedrive'])
const remote = z
	.object({
		path: z.string(),
		folderId: z.string().optional(),
		sharedDriveId: z.string().optional(),
		driveId: z.string().optional(),
		driveType: z.enum(['personal', 'business']).optional(),
	})
	.strict()
const destination = z
	.object({
		path: z.string(),
		filesystemUuid: z.string().optional(),
		host: z.string().optional(),
		share: z.string().optional(),
	})
	.strict()

const cloudProcedure = privateProcedureWithMembers.use(({ctx, next}) => {
	ctx.umbreld.files.cloud.assertReady()
	return next()
})

export default router({
	// List a directory
	list: publicProcedureWhenNoUserExistsWithMembers
		.input(
			z.object({
				path: z.string(),
				sortBy: z.enum(['name', 'type', 'modified', 'size']).default('name'),
				sortOrder: z.enum(['ascending', 'descending']).default('ascending'),
				lastFile: z.string().optional(),
				limit: z.number().positive().default(100),
			}),
		)
		.query(async ({ctx, input}) => {
			const directoryListing = await ctx.umbreld.files.list(input.path, ctx.principal?.accountId)
			const totalFiles = directoryListing.files.length

			// Sort the files
			// Ensure numeric sort falls back to text sort if the numeric values are equal.
			// This is to ensure deterministic ordering in the case where multiple files have
			// the same size/date. If ordering becomes non-deterministic then pagination can break.
			// We enable numeric sorting by name, e.g. 1.txt, 2.txt, 10.txt
			const textSort = new Intl.Collator('en-US', {numeric: true})
			directoryListing.files.sort((fileA, fileB) => {
				const a = input.sortBy === 'size' ? (fileA.size ?? 0) : fileA[input.sortBy]
				const b = input.sortBy === 'size' ? (fileB.size ?? 0) : fileB[input.sortBy]
				if (typeof a === 'string' && typeof b === 'string') return textSort.compare(a, b)
				if (typeof a === 'number' && typeof b === 'number') return a - b || textSort.compare(fileA.name, fileB.name)
				return 0
			})

			// Handle sort order
			if (input.sortOrder === 'descending') directoryListing.files.reverse()

			// Paginate using cursor-style pagination with `lastFile` as the cursor.
			// Unlike offset-based pagination, this ensures consistent results even if files are added, removed, or renamed, etc.
			// as it starts after the last seen file rather than relying on fixed indices.
			let startIndex = 0
			if (input.lastFile) {
				const lastFileIndex = directoryListing.files.findIndex((file) => file.name === input.lastFile)
				// If lastFile found, start after it; otherwise start from beginning
				startIndex = lastFileIndex !== -1 ? lastFileIndex + 1 : 0
			}

			// Get the paginated files
			const paginatedFiles = directoryListing.files.slice(startIndex, startIndex + input.limit)

			// Determine if there are more files after this batch
			const hasMore = startIndex + input.limit < totalFiles

			return {
				...directoryListing,
				// overwrite the files with the paginated files
				files: paginatedFiles,
				totalFiles,
				hasMore,
			}
		}),

	// Resolve a single owner-visible virtual path without listing its children.
	status: privateProcedure.input(z.object({path: z.string()})).query(async ({ctx, input}) => {
		const userId = ctx.principal?.accountId ?? OWNER_USER_ID
		const path = ctx.umbreld.files.normalizeVirtualPath(input.path)
		const systemPath = await ctx.umbreld.files.virtualToSystemPath(path, userId)
		return ctx.umbreld.files.status(systemPath, userId)
	}),

	// Efficient name-cursor listing for consumers that only need one page. The
	// regular Files UI route supports arbitrary sort fields and therefore stats
	// every entry; this route stats only the returned page.
	listDirectoryPage: privateProcedure
		.input(
			z.object({
				path: z.string(),
				lastFile: z.string().optional(),
				limit: z.number().int().min(1).max(250).default(100),
			}),
		)
		.query(async ({ctx, input}) => {
			const userId = ctx.principal?.accountId ?? OWNER_USER_ID
			const path = ctx.umbreld.files.normalizeVirtualPath(input.path)
			const systemPath = await ctx.umbreld.files.virtualToSystemPath(path, userId)
			const directory = await ctx.umbreld.files.status(systemPath, userId).catch((error) => {
				if (error?.message?.includes('ENOENT')) throw new Error('[does-not-exist]')
				throw error
			})

			const entries: {name: string; systemPath: string}[] = []
			let truncatedAt: number | undefined
			for await (const entrySystemPath of getDirectoryStream(systemPath)) {
				const name = nodePath.basename(entrySystemPath)
				if (ctx.umbreld.files.isHidden(name)) continue
				entries.push({name, systemPath: entrySystemPath})
				if (entries.length >= ctx.umbreld.files.maxDirectoryListing) {
					truncatedAt = ctx.umbreld.files.maxDirectoryListing
					break
				}
			}

			entries.sort((first, second) => compareFileNames(first.name, second.name))
			const start = input.lastFile ? entries.findIndex(({name}) => compareFileNames(name, input.lastFile!) > 0) : 0
			const startIndex = start === -1 ? entries.length : start
			const page = entries.slice(startIndex, startIndex + input.limit)
			const files = await Promise.all(
				page.map(({systemPath}) =>
					ctx.umbreld.files.status(systemPath, userId, {includeIndexedDirectorySize: false}).catch((error) => {
						ctx.umbreld.files.logger.error(`Failed to get status for '${systemPath}'`, error)
						return undefined
					}),
				),
			)
			const annotatedFiles = await ctx.umbreld.files.annotateIndexedDirectorySizes(
				files.filter((file) => file !== undefined),
			)

			return {
				...directory,
				files: annotatedFiles,
				totalFiles: entries.length,
				hasMore: startIndex + input.limit < entries.length,
				...(truncatedAt ? {truncatedAt} : {}),
			}
		}),

	// Resolve one accessible path's capabilities without listing all of its
	// children. Paste and drag/drop check this immediately before dispatch;
	// mutations still enforce the same rules independently.
	pathOperations: privateProcedureWithMembers.input(z.object({path: z.string()})).query(async ({ctx, input}) => {
		const userId = ctx.principal?.accountId ?? OWNER_USER_ID
		await ctx.umbreld.files.virtualToSystemPath(input.path, userId)
		return ctx.umbreld.files.getAllowedOperations(input.path, userId)
	}),

	// Create a directory
	createDirectory: privateProcedureWithMembers
		.input(z.object({path: z.string()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.files.createDirectory(input.path, ctx.principal?.accountId)),

	cleanupCreatedDirectory: privateProcedureWithMembers
		.input(
			z.object({
				path: z.string(),
				identity: z.object({
					device: z.number().int().nonnegative(),
					inode: z.number().int().nonnegative(),
					birthtimeMs: z.number().nonnegative(),
				}),
			}),
		)
		.mutation(async ({ctx, input}) =>
			ctx.umbreld.files.cleanupCreatedDirectory(input.path, input.identity, ctx.principal?.accountId),
		),

	// Copy a file or directory
	copy: privateProcedureWithMembers
		.input(
			z.object({
				path: z.string(),
				toDirectory: z.string(),
				collision: z.enum(['error', 'keep-both', 'replace']).default('error'),
			}),
		)
		.mutation(async ({ctx, input}) =>
			ctx.umbreld.files.copy(input.path, input.toDirectory, {
				collision: input.collision,
				userId: ctx.principal?.accountId,
			}),
		),

	// Move a file or directory
	move: privateProcedureWithMembers
		.input(
			z.object({
				path: z.string(),
				toDirectory: z.string(),
				collision: z.enum(['error', 'keep-both', 'replace']).default('error'),
			}),
		)
		.mutation(async ({ctx, input}) =>
			ctx.umbreld.files.move(input.path, input.toDirectory, {
				collision: input.collision,
				userId: ctx.principal?.accountId,
			}),
		),

	// Get progress of file operations
	// Scoped to the current account
	operationProgress: privateProcedureWithMembers.query(async ({ctx}) => {
		const userId = ctx.principal?.accountId ?? OWNER_USER_ID
		return ctx.umbreld.files.operationsInProgress.filter((operation) => operation.userId === userId)
	}),

	// Rename a file or directory
	rename: privateProcedureWithMembers
		.input(z.object({path: z.string(), newName: z.string().nonempty()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.files.rename(input.path, input.newName, ctx.principal?.accountId)),

	// Trash a file or directory
	trash: privateProcedureWithMembers
		.input(z.object({path: z.string()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.files.trash(input.path, ctx.principal?.accountId)),

	// Restore a file or directory from the trash
	restore: privateProcedureWithMembers
		.input(z.object({path: z.string(), collision: z.enum(['error', 'keep-both', 'replace']).default('error')}))
		.mutation(async ({ctx, input}) =>
			ctx.umbreld.files.restore(input.path, {collision: input.collision, userId: ctx.principal?.accountId}),
		),

	// Empty the trash
	emptyTrash: privateProcedureWithMembers.mutation(async ({ctx}) =>
		ctx.umbreld.files.emptyTrash(ctx.principal?.accountId),
	),

	// Permanently delete a file or directory
	delete: privateProcedureWithMembers
		.input(z.object({path: z.string()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.files.delete(input.path, ctx.principal?.accountId)),

	deleteMany: privateProcedureWithMembers
		.input(z.object({paths: z.array(z.string()).min(1)}))
		.mutation(async ({ctx, input}) => ctx.umbreld.files.deleteMany(input.paths, ctx.principal?.accountId)),

	// Get favorites
	favorites: privateProcedureWithMembers.query(async ({ctx}) =>
		ctx.umbreld.files.favorites.listFavorites(ctx.principal!.accountId),
	),

	// Add a favorite
	addFavorite: privateProcedureWithMembers
		.input(z.object({path: z.string()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.files.favorites.addFavorite(input.path, ctx.principal!.accountId)),

	// Remove a favorite
	removeFavorite: privateProcedureWithMembers
		.input(z.object({path: z.string()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.files.favorites.removeFavorite(input.path, ctx.principal!.accountId)),

	// Get recent files
	recents: privateProcedureWithMembers.query(async ({ctx}) => ctx.umbreld.files.recents.get(ctx.principal!.accountId)),

	// Get view preferences
	// Scoped to the current account
	// Public only when no user exists for onboarding restore flow (returns defaults); private once a user exists
	viewPreferences: publicProcedureWhenNoUserExistsWithMembers.query(async ({ctx}) =>
		ctx.umbreld.files.getViewPreferences(ctx.principal?.accountId),
	),

	// Update view preferences
	// Scoped to the current account
	updateViewPreferences: privateProcedureWithMembers
		.input(
			z.object({
				view: z.enum(['icons', 'list']).optional(),
				sortBy: z.enum(['name', 'type', 'modified', 'size']).optional(),
				sortOrder: z.enum(['ascending', 'descending']).optional(),
			}),
		)
		.mutation(async ({ctx, input}) => ctx.umbreld.files.updateViewPreferences(input, ctx.principal?.accountId)),

	// Create a zip archive
	archive: privateProcedureWithMembers
		.input(z.object({paths: z.array(z.string()).min(1)}))
		.mutation(async ({ctx, input}) => ctx.umbreld.files.archive.archive(input.paths, ctx.principal?.accountId)),

	// Unarchive a file
	unarchive: privateProcedureWithMembers
		.input(z.object({path: z.string()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.files.archive.unarchive(input.path, ctx.principal?.accountId)),

	// Get/generate a thumbnail for a file on demand
	getThumbnail: privateProcedureWithMembers
		.input(z.object({path: z.string()}))
		.mutation(async ({ctx, input}) =>
			ctx.umbreld.files.thumbnails.getThumbnailOnDemand(input.path, ctx.principal?.accountId),
		),

	// ── Member shares ───────────────────────────────────────────────────────
	// Owner paths shared with member accounts, distinct from samba network
	// shares below. External and network storage are granted by category root.

	// List all member shares (owner management view)
	memberShares: privateProcedure.query(async ({ctx}) => ctx.umbreld.files.memberShares.list()),

	// Share a path with all members or specific members. Upserts, so sharing an
	// already shared path updates who it's shared with.
	addMemberShare: privateProcedure
		.input(
			z.object({
				path: z.string(),
				sharedWith: z.union([z.literal('all'), z.array(z.string()).min(1)]),
			}),
		)
		.mutation(async ({ctx, input}) => ctx.umbreld.files.memberShares.add(input.path, input.sharedWith)),

	// Stop sharing a path
	removeMemberShare: privateProcedure
		.input(z.object({path: z.string()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.files.memberShares.remove(input.path)),

	// The paths shared with the current member account (drives their sidebar)
	sharedWithMe: privateProcedureWithMembers.query(async ({ctx}) => {
		const userId = ctx.principal?.accountId ?? OWNER_USER_ID
		const owner = await ctx.umbreld.user.get()
		const shares = await ctx.umbreld.files.memberShares.listForUser(userId)
		return {
			ownerName: owner?.name ?? '',
			...(owner?.avatarHash ? {ownerAvatarUrl: accountAvatarUrl(OWNER_USER_ID, owner.avatarHash)} : {}),
			shares: shares.map((share) => {
				const segments = share.path.split('/').filter(Boolean)
				const base =
					segments[0] === 'External'
						? 'external'
						: segments[0] === 'Network'
							? 'network'
							: segments[0] === 'Apps'
								? 'apps'
								: 'home'
				return {
					path: share.path,
					name: share.path === '/Home' ? 'Home' : segments[segments.length - 1],
					base: base as 'home' | 'external' | 'network' | 'apps',
				}
			}),
		}
	}),

	// Get the current account's Samba password
	sharePassword: privateProcedureWithMembers.query(async ({ctx}) =>
		ctx.umbreld.files.samba.getSharePassword(ctx.principal!.accountId),
	),

	// Change the current account's Samba password
	setSharePassword: privateProcedureWithMembers
		.input(z.object({password: sambaPassword}))
		.mutation(async ({ctx, input}) =>
			ctx.umbreld.files.samba.setSharePassword(ctx.principal!.accountId, input.password),
		),

	// Get the current account's shares
	shares: privateProcedureWithMembers.query(async ({ctx}) =>
		ctx.umbreld.files.samba.listShares(ctx.principal!.accountId),
	),

	// Share a directory
	addShare: privateProcedureWithMembers
		.input(z.object({path: z.string()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.files.samba.addShare(input.path, ctx.principal!.accountId)),

	// Remove a share
	removeShare: privateProcedureWithMembers
		.input(z.object({path: z.string()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.files.samba.removeShare(input.path, ctx.principal!.accountId)),

	// Owner-managed Samba access for member accounts. Passwords remain private
	// to the member and are never included in this owner-facing status list.
	memberSambaAccess: privateProcedure.query(async ({ctx}) => ctx.umbreld.files.samba.listMemberAccess()),

	setMemberSambaAccess: privateProcedure
		.input(z.object({userId: z.string().min(1), enabled: z.boolean()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.files.samba.setMemberAccess(input.userId, input.enabled)),

	// Format an external device
	formatExternalDevice: privateProcedure
		.input(
			z.object({
				deviceId: z.string(),
				filesystem: z.enum(['ext4', 'exfat']),
				label: z.string(),
			}),
		)
		.mutation(async ({ctx, input}) => ctx.umbreld.files.externalStorage.formatExternalDevice(input)),

	// Get external storage devices
	externalDevices: publicProcedureWhenNoUserExists.query(async ({ctx}) => {
		const devices = await ctx.umbreld.files.externalStorage.getExternalDevicesWithVirtualMountPoints()
		return devices.map((device) => ({
			...device,
			partitions: device.partitions.map(({filesystemType, ...partition}) => ({
				...partition,
				// Keep the policy server-owned: app data roots are only supported on
				// ext4 even if another filesystem happens to expose Unix ownership.
				supportsAppDataRoot: supportsAppDataRootFilesystem(filesystemType),
			})),
		}))
	}),

	// Unmount an external device
	unmountExternalDevice: privateProcedure
		.input(z.object({deviceId: z.string()}))
		.mutation(async ({ctx, input}) =>
			ctx.umbreld.files.externalStorage.unmountExternalDevice(input.deviceId, {remove: true}),
		),

	// Get Linux RAID (mdadm) array mounts surfaced under /Raid
	raidMounts: publicProcedureWhenNoUserExists.query(async ({ctx}) => ctx.umbreld.files.getRaidMounts()),

	// Unmount a RAID array and drop its persisted fstab entry
	unmountRaidMount: privateProcedure
		.input(z.object({device: z.string().regex(/^\/dev\/md\d+$/)}))
		.mutation(async ({ctx, input}) => ctx.umbreld.files.unmountRaidMount(input.device)),

	// Search for a file
	// Members are confined to their current account's home directory
	search: privateProcedureWithMembers
		.input(
			z.object({
				query: z.string().refine((query) => !query.includes('\0'), 'Search query cannot contain NUL'),
				maxResults: z.number().int().positive().max(1000).default(250).optional(),
			}),
		)
		.query(async ({ctx, input}) =>
			ctx.umbreld.files.search.search(input.query, input.maxResults, ctx.principal?.accountId),
		),

	// Owner-only recovery hook for rebuilding all disposable file index state.
	rebuildIndex: privateProcedure.mutation(async ({ctx}) => {
		await ctx.umbreld.files.fileIndex.rebuild()
		return {status: 'rebuilding' as const}
	}),

	// List network shares
	listNetworkShares: publicProcedureWhenNoUserExists.query(async ({ctx}) =>
		ctx.umbreld.files.networkStorage.getShareInfo(),
	),

	// Add a network share
	addNetworkShare: publicProcedureWhenNoUserExists
		.input(
			z.object({
				host: z.string(),
				share: z.string(),
				username: z.string(),
				password: z.string(),
			}),
		)
		.mutation(async ({ctx, input}) => ctx.umbreld.files.networkStorage.addShare(input)),

	// Remove a network share
	removeNetworkShare: privateProcedure
		.input(z.object({mountPath: z.string()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.files.networkStorage.removeShare(input.mountPath)),

	// Discover available network share servers
	discoverNetworkShareServers: publicProcedureWhenNoUserExists.query(async ({ctx}) =>
		ctx.umbreld.files.networkStorage.discoverServers(),
	),

	// Discover shares for a given samba server
	discoverNetworkSharesOnServer: publicProcedureWhenNoUserExists
		.input(z.object({host: z.string(), username: z.string(), password: z.string()}))
		.query(async ({ctx, input}) =>
			ctx.umbreld.files.networkStorage.discoverSharesOnServer(input.host, input.username, input.password),
		),

	// Checks if the given network address is an Umbrel device
	isServerAnUmbrelDevice: privateProcedure
		.input(z.object({address: z.string()}))
		.query(async ({ctx, input}) => ctx.umbreld.files.networkStorage.isServerAnUmbrelDevice(input.address)),

	cloud: router({
		providers: cloudProcedure.query(({ctx}) => ctx.umbreld.files.cloud.getProviders()),
		accounts: cloudProcedure.query(({ctx}) =>
			ctx.umbreld.files.cloud.getAccounts(ctx.principal?.accountId ?? OWNER_USER_ID),
		),
		syncs: cloudProcedure.query(({ctx}) => ctx.umbreld.files.cloud.getSyncs(ctx.principal?.accountId ?? OWNER_USER_ID)),
		activity: cloudProcedure.query(({ctx}) =>
			ctx.umbreld.files.cloud.getActivity(ctx.principal?.accountId ?? OWNER_USER_ID),
		),
		destination: cloudProcedure
			.input(z.object({path: z.string()}))
			.query(({ctx, input}) =>
				ctx.umbreld.files.getStorageDestination(input.path, ctx.principal?.accountId ?? OWNER_USER_ID),
			),
		locations: cloudProcedure
			.input(z.object({accountId}))
			.query(({ctx, input}) =>
				ctx.umbreld.files.cloud.getLocations(ctx.principal?.accountId ?? OWNER_USER_ID, input.accountId),
			),
		browse: cloudProcedure
			.input(z.object({accountId, remote, maxEntries: z.number().int().min(1).max(1000).default(500)}))
			.query(({ctx, input}) =>
				ctx.umbreld.files.cloud.browse(
					ctx.principal?.accountId ?? OWNER_USER_ID,
					input.accountId,
					input.remote,
					input.maxEntries,
				),
			),
		oauthBegin: cloudProcedure
			.input(z.object({provider: oauthProvider, accountId: accountId.optional()}))
			.mutation(({ctx, input}) =>
				ctx.umbreld.files.cloud.beginOAuth(ctx.principal?.accountId ?? OWNER_USER_ID, input.provider, input.accountId),
			),
		oauthComplete: cloudProcedure
			.input(z.object({accountId, code: z.string().min(1).max(8192)}))
			.mutation(({ctx, input}) =>
				ctx.umbreld.files.cloud.completeOAuth(ctx.principal?.accountId ?? OWNER_USER_ID, input.accountId, input.code),
			),
		oauthCancel: cloudProcedure
			.input(z.object({accountId, sessionId: z.string().uuid()}))
			.mutation(({ctx, input}) =>
				ctx.umbreld.files.cloud.cancelOAuth(
					ctx.principal?.accountId ?? OWNER_USER_ID,
					input.accountId,
					input.sessionId,
				),
			),
		connectWebDav: cloudProcedure
			.input(
				z.object({
					accountId: accountId.optional(),
					flavor: z.enum(CLOUD_WEBDAV_FLAVOR_IDS),
					url: z.string().min(1).max(8192),
					username: z.string().min(1).max(1024),
					password: z.string().min(1).max(8192),
					tlsMode: z.enum(['default', 'insecure']),
				}),
			)
			.mutation(({ctx, input}) => {
				const {accountId, ...credentials} = input
				return ctx.umbreld.files.cloud.connectWebDav(ctx.principal?.accountId ?? OWNER_USER_ID, credentials, accountId)
			}),
		beginICloud: cloudProcedure
			.input(
				z.object({
					accountId: accountId.optional(),
					appleId: z.string().min(1).max(320),
					password: z.string().min(1).max(1024),
				}),
			)
			.mutation(({ctx, input}) => {
				const {accountId, ...credentials} = input
				return ctx.umbreld.files.cloud.beginICloud(ctx.principal?.accountId ?? OWNER_USER_ID, credentials, accountId)
			}),
		continueICloud: cloudProcedure
			.input(z.object({accountId, result: z.string().min(1).max(8192)}))
			.mutation(({ctx, input}) =>
				ctx.umbreld.files.cloud.continueICloud(
					ctx.principal?.accountId ?? OWNER_USER_ID,
					input.accountId,
					input.result,
				),
			),
		create: cloudProcedure
			.input(z.object({accountId, remote, destination, mode: z.enum(CLOUD_SYNC_MODE_IDS)}))
			.mutation(({ctx, input}) =>
				ctx.umbreld.files.cloud.create({
					...input,
					userId: ctx.principal?.accountId ?? OWNER_USER_ID,
				}),
			),
		restore: cloudProcedure
			.input(
				z.object({
					confirmedSyncIds: z.array(z.string().uuid()).max(1000),
					workItems: z
						.array(
							z.object({
								path: z.string(),
								toDirectory: z.string(),
								collision: z.enum(['error', 'replace', 'keep-both']),
							}),
						)
						.min(1)
						.max(1000),
				}),
			)
			.mutation(({ctx, input}) =>
				ctx.umbreld.files.restoreFromRewind(
					input.workItems,
					input.confirmedSyncIds,
					ctx.principal?.accountId ?? OWNER_USER_ID,
				),
			),
		pause: cloudProcedure
			.input(z.object({syncId: z.string().uuid()}))
			.mutation(({ctx, input}) =>
				ctx.umbreld.files.cloud.pause(ctx.principal?.accountId ?? OWNER_USER_ID, input.syncId),
			),
		resume: cloudProcedure
			.input(z.object({syncId: z.string().uuid()}))
			.mutation(({ctx, input}) =>
				ctx.umbreld.files.cloud.resume(ctx.principal?.accountId ?? OWNER_USER_ID, input.syncId),
			),
		run: cloudProcedure
			.input(z.object({syncId: z.string().uuid()}))
			.mutation(({ctx, input}) =>
				ctx.umbreld.files.cloud.runOnce(ctx.principal?.accountId ?? OWNER_USER_ID, input.syncId),
			),
		remove: cloudProcedure
			.input(z.object({syncId: z.string().uuid()}))
			.mutation(({ctx, input}) =>
				ctx.umbreld.files.cloud.remove(ctx.principal?.accountId ?? OWNER_USER_ID, input.syncId),
			),
		removeAccount: cloudProcedure
			.input(z.object({accountId, confirmedSyncIds: z.array(z.string().uuid())}))
			.mutation(({ctx, input}) =>
				ctx.umbreld.files.cloud.removeAccount(
					ctx.principal?.accountId ?? OWNER_USER_ID,
					input.accountId,
					input.confirmedSyncIds,
				),
			),
	}),
})
