import {TRPCError} from '@trpc/server'
import z from 'zod'

import {NativeSessionRequiredError, type Principal} from '../auth/auth.js'
import {privateProcedureWithMembers, router} from '../server/trpc/trpc.js'

import {PHOTO_BACKUP_SOURCE_ID_PATTERN, PHOTO_FILE_EXTENSION_PATTERN, PHOTO_RESOURCE_KEY_PATTERN} from './photos.js'
import {PHOTO_KINDS, PHOTO_SCOPE_MODES, PHOTO_SUB_KINDS} from './types.js'

const backupSourceInput = z.object({
	sourceId: z.string().regex(PHOTO_BACKUP_SOURCE_ID_PATTERN),
	suggestedName: z
		.string()
		.trim()
		.min(1)
		.max(100)
		.regex(/^[^\u0000-\u001f\u007f]*$/),
})

const backupResourceReceiptsInput = z.object({
	sourceId: z.string().regex(PHOTO_BACKUP_SOURCE_ID_PATTERN),
	resources: z
		.array(
			z.object({
				resourceKey: z.string().regex(PHOTO_RESOURCE_KEY_PATTERN),
				fileExtension: z.string().regex(PHOTO_FILE_EXTENSION_PATTERN),
			}),
		)
		.max(256),
})

const filterSchema = z.object({
	query: z.string().optional(),
	kind: z.enum(PHOTO_KINDS).optional(),
	subKind: z.enum(PHOTO_SUB_KINDS).optional(),
	favorite: z.boolean().optional(),
	deleted: z.boolean().optional(),
	sourceIds: z.array(z.string()).optional(),
	albumIds: z.array(z.string()).optional(),
	dates: z.array(z.object({from: z.number(), to: z.number()})).optional(),
})
const ids = z.object({ids: z.array(z.string()).min(1)})
const accountId = (context: {principal?: Principal}) => {
	if (!context.principal) throw new TRPCError({code: 'UNAUTHORIZED'})
	return context.principal.accountId
}

export default router({
	createBackupGrant: privateProcedureWithMembers.input(backupSourceInput).mutation(async ({ctx, input}) => {
		if (!ctx.request || !ctx.response) {
			throw new TRPCError({code: 'METHOD_NOT_SUPPORTED', message: 'HTTP transport required'})
		}

		await ctx.umbreld.auth.validateNativePrincipal(ctx.principal!).catch((error) => {
			if (error instanceof NativeSessionRequiredError) {
				throw new TRPCError({code: 'FORBIDDEN', message: error.message})
			}
			throw error
		})
		const grant = await ctx.umbreld.photos.createBackupGrant({principal: ctx.principal!, ...input})
		ctx.response.set('Cache-Control', 'no-store')
		return grant
	}),

	revokeBackupGrant: privateProcedureWithMembers.mutation(async ({ctx}) => {
		return ctx.umbreld.auth.revokePhotoBackupGrant(ctx.principal!).catch((error) => {
			if (error instanceof NativeSessionRequiredError) {
				throw new TRPCError({code: 'FORBIDDEN', message: error.message})
			}
			throw error
		})
	}),

	// tRPC mutations use POST, keeping a bounded batch of resource keys out of the
	// URL. This procedure is read-only and safe for native clients to replay after a
	// route change.
	confirmedBackupResources: privateProcedureWithMembers
		.input(backupResourceReceiptsInput)
		.mutation(async ({ctx, input}) => {
			return ctx.umbreld.photos.confirmedBackupResources({
				accountId: ctx.principal!.accountId,
				...input,
			})
		}),

	library: router({
		summary: privateProcedureWithMembers.query(({ctx}) => ctx.umbreld.photos.summary(accountId(ctx))),
		status: privateProcedureWithMembers.query(({ctx}) => ctx.umbreld.photos.indexingState(accountId(ctx))),
	}),

	items: router({
		list: privateProcedureWithMembers
			.input(
				z.object({
					filter: filterSchema.default({}),
					cursor: z.string().optional(),
					limit: z.number().int().min(1).max(1000).default(200),
				}),
			)
			.query(({ctx, input}) => ctx.umbreld.photos.listItems(accountId(ctx), input.filter, input.cursor, input.limit)),
		get: privateProcedureWithMembers
			.input(z.object({id: z.string(), deleted: z.boolean().default(false)}))
			.query(async ({ctx, input}) => {
				const item = await ctx.umbreld.photos.getItem(accountId(ctx), input.id, input.deleted)
				if (!item) throw new TRPCError({code: 'NOT_FOUND'})
				return item
			}),
		neighbors: privateProcedureWithMembers
			.input(z.object({id: z.string(), filter: filterSchema.default({})}))
			.query(async ({ctx, input}) => {
				const neighbors = await ctx.umbreld.photos.neighbors(accountId(ctx), input.id, input.filter)
				if (!neighbors) throw new TRPCError({code: 'NOT_FOUND'})
				return neighbors
			}),
		createDownload: privateProcedureWithMembers.input(ids).mutation(async ({ctx, input}) => {
			try {
				return {ticket: await ctx.umbreld.photos.createDownloadTicket(accountId(ctx), input.ids)}
			} catch (error) {
				if (error instanceof Error && error.message === '[photos-item-not-found]') {
					throw new TRPCError({code: 'NOT_FOUND'})
				}
				throw error
			}
		}),
		setFavorite: privateProcedureWithMembers
			.input(ids.extend({favorite: z.boolean()}))
			.mutation(({ctx, input}) => ctx.umbreld.photos.setFavorite(accountId(ctx), input.ids, input.favorite)),
		delete: privateProcedureWithMembers
			.input(ids)
			.mutation(({ctx, input}) => ctx.umbreld.photos.deleteItems(accountId(ctx), input.ids)),
		restore: privateProcedureWithMembers
			.input(ids)
			.mutation(({ctx, input}) => ctx.umbreld.photos.restoreItems(accountId(ctx), input.ids)),
		deletePermanently: privateProcedureWithMembers
			.input(z.object({ids: z.array(z.string()).optional()}))
			.mutation(({ctx, input}) => ctx.umbreld.photos.deletePermanently(accountId(ctx), input.ids)),
	}),

	albums: router({
		list: privateProcedureWithMembers.query(({ctx}) => ctx.umbreld.photos.listAlbums(accountId(ctx))),
		create: privateProcedureWithMembers
			.input(z.object({name: z.string().trim().min(1), ids: z.array(z.string()).optional()}))
			.mutation(({ctx, input}) => ctx.umbreld.photos.createAlbum(accountId(ctx), input.name, input.ids)),
		rename: privateProcedureWithMembers
			.input(z.object({id: z.string(), name: z.string().trim().min(1)}))
			.mutation(async ({ctx, input}) => {
				if (!(await ctx.umbreld.photos.renameAlbum(accountId(ctx), input.id, input.name))) {
					throw new TRPCError({code: 'NOT_FOUND'})
				}
			}),
		setCover: privateProcedureWithMembers
			.input(z.object({id: z.string(), itemId: z.string().optional()}))
			.mutation(async ({ctx, input}) => {
				if (!(await ctx.umbreld.photos.setAlbumCover(accountId(ctx), input.id, input.itemId))) {
					throw new TRPCError({code: 'NOT_FOUND'})
				}
			}),
		delete: privateProcedureWithMembers.input(z.object({id: z.string()})).mutation(async ({ctx, input}) => {
			if (!(await ctx.umbreld.photos.deleteAlbum(accountId(ctx), input.id))) {
				throw new TRPCError({code: 'NOT_FOUND'})
			}
		}),
		addItems: privateProcedureWithMembers
			.input(ids.extend({id: z.string()}))
			.mutation(({ctx, input}) => ctx.umbreld.photos.addAlbumItems(accountId(ctx), input.id, input.ids)),
		removeItems: privateProcedureWithMembers
			.input(ids.extend({id: z.string()}))
			.mutation(({ctx, input}) => ctx.umbreld.photos.removeAlbumItems(accountId(ctx), input.id, input.ids)),
	}),

	sources: router({
		list: privateProcedureWithMembers.query(({ctx}) => ctx.umbreld.photos.listSources(accountId(ctx))),
		rename: privateProcedureWithMembers
			.input(z.object({id: z.string(), name: backupSourceInput.shape.suggestedName}))
			.mutation(async ({ctx, input}) => {
				if (!(await ctx.umbreld.photos.renameSource(accountId(ctx), input.id, input.name))) {
					throw new TRPCError({code: 'NOT_FOUND'})
				}
			}),
		update: privateProcedureWithMembers
			.input(
				z.object({
					id: z.string(),
					scope: z.object({mode: z.enum(PHOTO_SCOPE_MODES), paths: z.array(z.string())}).optional(),
				}),
			)
			.mutation(async ({ctx, input}) => {
				let source
				try {
					source = await ctx.umbreld.photos.updateSource(accountId(ctx), input.id, input.scope)
				} catch (error) {
					if (error instanceof Error && error.message === '[photos-invalid-scope-path]') {
						throw new TRPCError({code: 'BAD_REQUEST', message: 'Source paths must be inside your home folder'})
					}
					if (error instanceof Error && error.message === '[photos-source-scope-unsupported]') {
						throw new TRPCError({code: 'BAD_REQUEST', message: 'This source does not support folder scope'})
					}
					throw error
				}
				if (!source) throw new TRPCError({code: 'NOT_FOUND'})
				return source
			}),
		remove: privateProcedureWithMembers
			.input(z.object({id: z.string(), keepItems: z.boolean().default(true)}))
			.mutation(async ({ctx, input}) => {
				if (!(await ctx.umbreld.photos.removeSource(accountId(ctx), input.id, input.keepItems))) {
					throw new TRPCError({code: 'BAD_REQUEST', message: 'The built-in Umbrel source cannot be removed'})
				}
			}),
	}),
})
