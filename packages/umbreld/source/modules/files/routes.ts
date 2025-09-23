import z from 'zod'

import {router, privateProcedure, publicProcedureWhenNoUserExists} from '../server/trpc/trpc.js'

export default router({
	// List a directory
	list: privateProcedure
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
			const directoryListing = await ctx.umbreld.files.list(input.path)
			const totalFiles = directoryListing.files.length

			// Sort the files
			// Ensure numeric sort falls back to text sort if the numeric values are equal.
			// This is to ensure deterministic ordering in the case where multiple files have
			// the same size/date. If ordering becomes non-deterministic then pagination can break.
			// We enable numeric sorting by name, e.g. 1.txt, 2.txt, 10.txt
			const textSort = new Intl.Collator('en-US', {numeric: true})
			directoryListing.files.sort((fileA, fileB) => {
				const a = fileA[input.sortBy]
				const b = fileB[input.sortBy]
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

	// Create a directory
	createDirectory: privateProcedure
		.input(z.object({path: z.string()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.files.createDirectory(input.path)),

	// Copy a file or directory
	copy: privateProcedure
		.input(
			z.object({
				path: z.string(),
				toDirectory: z.string(),
				collision: z.enum(['error', 'keep-both', 'replace']).default('error'),
			}),
		)
		.mutation(async ({ctx, input}) =>
			ctx.umbreld.files.copy(input.path, input.toDirectory, {collision: input.collision}),
		),

	// Move a file or directory
	move: privateProcedure
		.input(
			z.object({
				path: z.string(),
				toDirectory: z.string(),
				collision: z.enum(['error', 'keep-both', 'replace']).default('error'),
			}),
		)
		.mutation(async ({ctx, input}) =>
			ctx.umbreld.files.move(input.path, input.toDirectory, {collision: input.collision}),
		),

	// Get progress of file operations
	operationProgress: privateProcedure.query(async ({ctx}) => ctx.umbreld.files.operationsInProgress),

	// Rename a file or directory
	rename: privateProcedure
		.input(z.object({path: z.string(), newName: z.string().nonempty()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.files.rename(input.path, input.newName)),

	// Trash a file or directory
	trash: privateProcedure
		.input(z.object({path: z.string()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.files.trash(input.path)),

	// Restore a file or directory from the trash
	restore: privateProcedure
		.input(z.object({path: z.string(), collision: z.enum(['error', 'keep-both', 'replace']).default('error')}))
		.mutation(async ({ctx, input}) => ctx.umbreld.files.restore(input.path, {collision: input.collision})),

	// Empty the trash
	emptyTrash: privateProcedure.mutation(async ({ctx}) => ctx.umbreld.files.emptyTrash()),

	// Permanently delete a file or directory
	delete: privateProcedure
		.input(z.object({path: z.string()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.files.delete(input.path)),

	// Get favorites
	favorites: privateProcedure.query(async ({ctx}) => ctx.umbreld.files.favorites.listFavorites()),

	// Add a favorite
	addFavorite: privateProcedure
		.input(z.object({path: z.string()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.files.favorites.addFavorite(input.path)),

	// Remove a favorite
	removeFavorite: privateProcedure
		.input(z.object({path: z.string()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.files.favorites.removeFavorite(input.path)),

	// Get recent files
	recents: privateProcedure.query(async ({ctx}) => ctx.umbreld.files.recents.get()),

	// Get view preferences
	viewPreferences: privateProcedure.query(async ({ctx}) => ctx.umbreld.files.getViewPreferences()),

	// Update view preferences
	updateViewPreferences: privateProcedure
		.input(
			z.object({
				view: z.enum(['icons', 'list']).optional(),
				sortBy: z.enum(['name', 'type', 'modified', 'size']).optional(),
				sortOrder: z.enum(['ascending', 'descending']).optional(),
			}),
		)
		.mutation(async ({ctx, input}) => ctx.umbreld.files.updateViewPreferences(input)),

	// Create a zip archive
	archive: privateProcedure
		.input(z.object({paths: z.array(z.string()).min(1)}))
		.mutation(async ({ctx, input}) => ctx.umbreld.files.archive.archive(input.paths)),

	// Unarchive a file
	unarchive: privateProcedure
		.input(z.object({path: z.string()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.files.archive.unarchive(input.path)),

	// Get/generate a thumbnail for a file on demand
	getThumbnail: privateProcedure
		.input(z.object({path: z.string()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.files.thumbnails.getThumbnailOnDemand(input.path)),

	// Get the share password
	sharePassword: privateProcedure.query(async ({ctx}) => ctx.umbreld.files.samba.getSharePassword()),

	// Get shares
	shares: privateProcedure.query(async ({ctx}) => ctx.umbreld.files.samba.listShares()),

	// Share a directory
	addShare: privateProcedure
		.input(z.object({path: z.string()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.files.samba.addShare(input.path)),

	// Remove a share
	removeShare: privateProcedure
		.input(z.object({path: z.string()}))
		.mutation(async ({ctx, input}) => ctx.umbreld.files.samba.removeShare(input.path)),

	// Get mounted external storage devices
	mountedExternalDevices: privateProcedure.query(async ({ctx}) =>
		ctx.umbreld.files.externalStorage.getMountedExternalDevices(),
	),

	// Unmount an external device
	unmountExternalDevice: privateProcedure
		.input(z.object({deviceId: z.string()}))
		.mutation(async ({ctx, input}) =>
			ctx.umbreld.files.externalStorage.unmountExternalDevice(input.deviceId, {remove: true}),
		),

	// Check if an external drive is connected on non-Umbrel Home hardware
	isExternalDeviceConnectedOnUnsupportedDevice: privateProcedure.query(({ctx}) =>
		ctx.umbreld.files.externalStorage.isExternalDeviceConnectedOnUnsupportedDevice(),
	),

	// Search for a file
	search: privateProcedure
		.input(
			z.object({
				query: z.string(),
				maxResults: z.number().positive().max(1000).default(250).optional(),
			}),
		)
		.query(async ({ctx, input}) => ctx.umbreld.files.search.search(input.query, input.maxResults)),

	// List network shares
	listNetworkShares: privateProcedure.query(async ({ctx}) => ctx.umbreld.files.networkStorage.getShareInfo()),

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
	discoverNetworkShareServers: privateProcedure.query(async ({ctx}) =>
		ctx.umbreld.files.networkStorage.discoverServers(),
	),

	// Discover shares for a given samba server
	discoverNetworkSharesOnServer: privateProcedure
		.input(z.object({host: z.string(), username: z.string(), password: z.string()}))
		.query(async ({ctx, input}) =>
			ctx.umbreld.files.networkStorage.discoverSharesOnServer(input.host, input.username, input.password),
		),

	// Checks if the given network address is an Umbrel device
	isServerAnUmbrelDevice: privateProcedure
		.input(z.object({address: z.string()}))
		.query(async ({ctx, input}) => ctx.umbreld.files.networkStorage.isServerAnUmbrelDevice(input.address)),
})
