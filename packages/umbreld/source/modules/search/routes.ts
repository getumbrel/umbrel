import {TRPCError} from '@trpc/server'
import z from 'zod'

import type {Principal} from '../auth/auth.ts'
import {filterSchema as photoFilterSchema} from '../photos/routes.ts'
import {privateProcedure, privateProcedureWithMembers, router} from '../server/trpc/trpc.ts'

import {SEARCH_SCOPES} from './types.ts'

const accountId = (context: {principal?: Principal}) => {
	if (!context.principal) throw new TRPCError({code: 'UNAUTHORIZED'})
	return context.principal.accountId
}

const text = z
	.string()
	.max(1000)
	.refine((value) => !value.includes('\0'), 'Search query cannot contain NUL')

export default router({
	status: privateProcedureWithMembers.query(({ctx}) => ctx.umbreld.search.status(accountId(ctx))),

	query: privateProcedureWithMembers
		.input(
			z
				.object({
					query: text,
					scope: z.enum(SEARCH_SCOPES).default('everything'),
					limit: z.number().int().positive().max(500).default(50),
					// Where a page starts: the `nextCursor` of the page before it
					cursor: z.number().int().min(0).max(100_000).optional(),
					// The Photos view being searched, exactly as photos.items.list
					// takes it, less `query`: the search text is the query here
					filter: photoFilterSchema.omit({query: true}).optional(),
					// The places the search is narrowed to, by the ids a response
					// names the places it understood by
					placeIds: z.array(z.string().max(32)).max(20).optional(),
				})
				.refine(({scope, filter}) => scope === 'photos' || !filter, 'Only the photos scope takes a Photos view'),
		)
		.query(({ctx, input}) => ctx.umbreld.search.query(accountId(ctx), input.query, input)),

	// Whether the models read the library, and how far along each kind of
	// work on it is. Turning it off or on is the owner's to do.
	indexing: privateProcedureWithMembers.query(({ctx}) => ctx.umbreld.search.indexing(accountId(ctx))),
	setIndexing: privateProcedure
		.input(z.object({enabled: z.boolean()}))
		.mutation(({ctx, input}) => ctx.umbreld.search.setIndexing(input.enabled)),

	// Exactly one of `path` (a virtual Files path) or `photoId`
	insights: privateProcedureWithMembers
		.input(z.union([z.object({path: text}), z.object({photoId: z.string().regex(/^[a-f0-9]{64}$/)})]))
		.query(({ctx, input}) => ctx.umbreld.search.insights(accountId(ctx), input)),
})
