import type {McpServer} from '@modelcontextprotocol/server'
import {z} from 'zod4'

import type {McpPermissions} from '../mcp.ts'
import {fileDto} from './files.ts'
import {stretch} from './photos.ts'
import {MCP_PERMISSION_REMEDIATION, runTool, type McpToolContext} from './shared.ts'

// Search, for an agent: all of Home as files with full Home access, and the
// Photos library as photos with Photos access. Either is enough for the tool.
export default function registerSearchTools(server: McpServer, context: McpToolContext, permissions: McpPermissions) {
	const home = permissions.files === 'all' || permissions.files.includes('/Home')
	if (!home && !permissions.photos) return

	server.registerTool(
		'search_files',
		{
			title: 'Search Home files',
			description: [
				'Finds files in /Home by name and by what is in them: what a photo or video shows, the text in a document or a picture, and what is said in a video or a recording.',
				'Describe what you are looking for in plain words ("ikea receipt", "a dog on a beach", an invoice number).',
				'With scope \'photos\' only the Photos library is searched, and the people the owner has named, places, dates and kinds of thing in the query narrow it ("dad in thailand 2026", "screenshots from last week"): `filters` says which were read. Words in double quotes are only ever looked for as words. That scope can also be narrowed exactly, by `from`, `to`, `personIds`, `albumId`, `kind` and `favorite`, and each result in the library has the `photoId` the Photos tools take.',
				'Results come surest first, each with why it matched (`match`: name, text, speech or visual, or filters where the whole query was read as filters and it fits them) and, for a video or a recording, the `moment` it matched at.',
				'Where the device cannot look inside files, or has not finished reading them, `note` says so: until then some or all results are by name alone.',
				"Scope 'everything' needs full Home access, and scope 'photos' Photos access.",
			].join(' '),
			inputSchema: z.object({
				query: z.string().min(1).max(500).describe('What to find: a description, words from it, or a file name.'),
				scope: z
					.enum(['everything', 'photos'])
					.default(home ? 'everything' : 'photos')
					.describe(
						"'everything' searches all of /Home. 'photos' searches only photos and videos in the Photos library.",
					),
				from: z
					.string()
					.optional()
					.describe("With scope 'photos': taken at or after this ISO 8601 date (2026-11-21) or date and time."),
				to: z
					.string()
					.optional()
					.describe("With scope 'photos': taken before this, or on this day where it is a date alone."),
				personIds: z
					.array(z.string())
					.max(20)
					.optional()
					.describe("With scope 'photos': only photos every one of these people is in (ids from list_people)."),
				albumId: z.string().optional().describe("With scope 'photos': only photos in this album."),
				kind: z.enum(['photo', 'video']).optional().describe("With scope 'photos': only photos, or only videos."),
				favorite: z.boolean().optional().describe("With scope 'photos': only favourites."),
				limit: z.number().int().min(1).max(250).default(50),
				cursor: z
					.number()
					.int()
					.min(0)
					.optional()
					.describe('The nextCursor of the previous page of the same search, for the page after it.'),
			}),
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		(input) =>
			runTool(context, 'search_files', input, async () => {
				const photos = await context.mcp.hasPhotosAccess()
				if (input.scope === 'photos') await context.mcp.assertPhotosAccess()
				if (input.scope === 'everything' && !(await context.mcp.hasFullHomeAccess())) {
					throw new Error(`[permission-denied] Full /Home access is required for search. ${MCP_PERMISSION_REMEDIATION}`)
				}
				// What a search of Photos is narrowed to, as a view of it is
				const dates = stretch(input.from, input.to)
				const filter = {
					...(dates ? {dates} : {}),
					...(input.personIds?.length ? {personIds: input.personIds} : {}),
					...(input.albumId ? {albumIds: [input.albumId]} : {}),
					...(input.kind ? {kind: input.kind} : {}),
					...(input.favorite === undefined ? {} : {favorite: input.favorite}),
				}
				const narrowed = Object.keys(filter).length > 0
				if (narrowed && input.scope !== 'photos') {
					throw new Error("[invalid-input] from, to, personIds, albumId, kind and favorite need scope 'photos'.")
				}
				// As the owner, like everything else here: only what is theirs is found
				const [found, status] = await Promise.all([
					context.rpc.search.query({
						query: input.query,
						// Without Photos, what is in the library is found as files, as Files finds it
						scope: input.scope === 'everything' && !photos ? 'files' : input.scope,
						limit: input.limit,
						...(narrowed ? {filter} : {}),
						...(input.cursor === undefined ? {} : {cursor: input.cursor}),
					}),
					context.rpc.search.status(),
				])
				// With nothing left to look for once the filters are read, what is
				// found in the library is found for fitting them, which Search has
				// no word for of its own
				const fits = found.understood.chips.length > 0 && !found.understood.text
				return {
					files: found.results.map(({file, match, photo, moment, page}) => ({
						...fileDto(file),
						// What the Photos tools know it by, where it is in the library
						...(photo ? {photoId: photo.id} : {}),
						match: fits && photo && match === 'name' ? 'filters' : match,
						...(moment
							? {moment: {startMs: moment.startMs, ...(moment.endMs === undefined ? {} : {endMs: moment.endMs})}}
							: {}),
						...(page === undefined ? {} : {page}),
					})),
					totalFiles: found.total,
					hasMore: found.nextCursor !== undefined,
					...(found.nextCursor === undefined ? {} : {nextCursor: found.nextCursor}),
					...(found.understood.chips.length > 0
						? {filters: found.understood.chips.map(({type, label}) => ({type, label}))}
						: {}),
					...searchNote(status),
				}
			}),
	)
}

// What an agent has to know to read a search's results right: that files were
// not looked inside at all, or not all of them yet
function searchNote({
	available,
	reason,
	indexing,
}: {
	available: boolean
	reason?: string
	indexing: {completed: number; total: number; off?: boolean}
}) {
	if (!available) {
		return {
			note:
				reason === 'unsupported-device'
					? 'This device cannot look inside files: only file names were searched.'
					: 'Search by what is in files is not ready yet: only file names were searched.',
		}
	}
	if (indexing.completed >= indexing.total) return {}
	const read = Math.floor((100 * indexing.completed) / indexing.total)
	return {
		note: indexing.off
			? `Reading files for search is turned off in Settings, with ${read}% of them read: results may be incomplete.`
			: `Files are still being read for search (${read}% done): results may be incomplete.`,
	}
}
