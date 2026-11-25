import type {CallToolResult, McpServer} from '@modelcontextprotocol/server'
import {z} from 'zod4'

import type {McpPermissions} from '../mcp.ts'
import {runTool, runToolResult, type McpToolContext} from './shared.ts'

// Photos, for an agent: what is in the library, its albums and favourites,
// and who is in it. Photos are found with search_files (scope 'photos') or
// listed here, and are named by their `photoId` everywhere.
//
// The library is the owner's: every photo and video in their Home. These
// tools need Photos access, whatever folders are granted, and are not listed
// without it; folder grants give photos only as files. get_photo shows the
// picture and what Search read off it and heard in it. Nothing is deleted
// for good: a photo goes to Recently Deleted, from where it can be put back.

const READ = {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false}
// Changes what is kept about photos (an album, a favourite, a name), not the photos
const ARRANGE = {readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false}
const REMOVE = {readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false}

const photoIds = z.array(z.string()).min(1).max(1000).describe('Photo ids, as search_files and list_photos give them.')
const day =
	'An ISO 8601 date (2026-11-21, a day by the device’s own clock) or date and time (2026-11-21T18:00:00+07:00).'

// When a date an agent gave is, in milliseconds: a date alone is the start
// of that day by the device's clock, or with `after` the start of the next,
// so that a stretch up to a day takes that day in
export function instant(value: string, after = false) {
	const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
	const time = date
		? new Date(Number(date[1]), Number(date[2]) - 1, Number(date[3]) + (after ? 1 : 0)).getTime()
		: Date.parse(value)
	if (Number.isNaN(time)) throw new Error(`[invalid-date] '${value}' is not an ISO 8601 date or date and time.`)
	return time
}

// The stretch of time two dates an agent gave are the ends of, as Photos filters by one
export function stretch(from?: string, to?: string) {
	if (from === undefined && to === undefined) return undefined
	return [{from: from === undefined ? 0 : instant(from), to: to === undefined ? 8.64e15 : instant(to, true)}]
}

const stamp = (time: number) => new Date(time).toISOString()

// Text read off a picture and what is said in a video can run long; an agent
// gets enough to know what is there, and the file has the rest
const MAX_TEXT_LENGTH = 2_000
const MAX_TRANSCRIPT_LENGTH = 4_000

function clip(text: string | undefined, length: number) {
	return text && text.length > length ? `${text.slice(0, length)}…` : text
}

type Item = {
	id: string
	kind: string
	subKind?: string
	takenAt: number
	durationMs?: number
	isFavorite: boolean
}

export function photoDto({id, kind, subKind, takenAt, durationMs, isFavorite}: Item) {
	return {
		photoId: id,
		kind,
		...(subKind ? {subKind} : {}),
		takenAt: stamp(takenAt),
		...(durationMs === undefined ? {} : {durationMs}),
		favorite: isFavorite,
	}
}

type Album = {id: string; name: string; count: number; takenFrom?: number; takenTo?: number}

function albumDto({id, name, count, takenFrom, takenTo}: Album) {
	return {
		albumId: id,
		name,
		photos: count,
		...(takenFrom === undefined ? {} : {takenFrom: stamp(takenFrom)}),
		...(takenTo === undefined ? {} : {takenTo: stamp(takenTo)}),
	}
}

export default function registerPhotoTools(server: McpServer, context: McpToolContext, permissions: McpPermissions) {
	if (!permissions.photos) return
	const {photos} = context.rpc

	server.registerTool(
		'list_photos',
		{
			title: 'List photos',
			description:
				"Lists the photos and videos in the owner's Photos library, the latest first, narrowed by when they were taken, who is in them, an album, a kind, or being a favourite. To find photos by where they were taken, what they show, or words in them, use search_files with scope 'photos', which takes the same narrowing. With `deleted`, lists Recently Deleted.",
			inputSchema: z.object({
				from: z.string().optional().describe(`Taken at or after this. ${day}`),
				to: z.string().optional().describe(`Taken before this, or on this day where it is a date alone. ${day}`),
				personIds: z
					.array(z.string())
					.max(20)
					.optional()
					.describe('Only photos every one of these people is in (ids from list_people).'),
				albumId: z.string().optional().describe('Only photos in this album (an id from list_albums).'),
				kind: z.enum(['photo', 'video']).optional(),
				favorite: z.boolean().optional().describe('Only favourites, or with false only what is not one.'),
				deleted: z.boolean().optional().describe('List Recently Deleted in place of the library.'),
				limit: z.number().int().min(1).max(500).default(100),
				cursor: z.string().optional().describe('The nextCursor of the page before, for the page after it.'),
			}),
			annotations: READ,
		},
		(input) =>
			runTool(context, 'list_photos', input, async () => {
				await context.mcp.assertPhotosAccess()
				const dates = stretch(input.from, input.to)
				const page = await photos.items.list({
					filter: {
						...(dates ? {dates} : {}),
						...(input.personIds?.length ? {personIds: input.personIds} : {}),
						...(input.albumId ? {albumIds: [input.albumId]} : {}),
						...(input.kind ? {kind: input.kind} : {}),
						...(input.favorite === undefined ? {} : {favorite: input.favorite}),
						...(input.deleted ? {deleted: true} : {}),
					},
					limit: input.limit,
					...(input.cursor ? {cursor: input.cursor} : {}),
				})
				return {
					photos: page.items.map(photoDto),
					...(page.total === undefined ? {} : {totalPhotos: page.total}),
					hasMore: page.nextCursor !== undefined,
					...(page.nextCursor === undefined ? {} : {nextCursor: page.nextCursor}),
				}
			}),
	)

	server.registerTool(
		'get_photo',
		{
			title: 'Get photo details',
			description:
				'What is known about one photo or video: its file and where it is in /Home, when and where it was taken, the camera, the albums it is in, who is in it, text read off it and what is said in it, and the picture itself (a still for a video) so you can see it.',
			inputSchema: z.object({
				photoId: z.string(),
				image: z.boolean().default(true).describe('Include the picture, 512 pixels on its short side.'),
			}),
			annotations: READ,
		},
		(input) =>
			runToolResult(context, 'get_photo', input, async (): Promise<CallToolResult> => {
				await context.mcp.assertPhotosAccess()
				const [item, insights] = await Promise.all([
					photos.items.get({id: input.photoId}),
					// What Search has read off it and heard in it, which it may not have yet
					context.rpc.search.insights({photoId: input.photoId}).catch(() => undefined),
				])
				const transcript = insights?.transcript
					?.map(({startMs, text}) => `[${Math.floor(startMs / 1000)}s] ${text}`)
					.join('\n')
				const details = {
					...photoDto(item),
					name: item.fileName,
					path: item.path,
					size: item.sizeBytes,
					width: item.width,
					height: item.height,
					source: item.source.name,
					...(item.location ? {location: {latitude: item.location.lat, longitude: item.location.lng}} : {}),
					...(item.exif?.make || item.exif?.model
						? {camera: [item.exif.make, item.exif.model].filter(Boolean).join(' ')}
						: {}),
					albums: item.albums.map(({id, name}) => ({albumId: id, name})),
					people: item.people.map(({id, name}) => ({personId: id, ...(name ? {name} : {})})),
					...(insights?.text ? {text: clip(insights.text, MAX_TEXT_LENGTH)} : {}),
					...(transcript ? {transcript: clip(transcript, MAX_TRANSCRIPT_LENGTH)} : {}),
				}
				const content: CallToolResult['content'] = [{type: 'text', text: JSON.stringify(details, null, 2)}]
				if (input.image) content.push({type: 'image', ...(await context.photos.image(input.photoId))})
				return {content}
			}),
	)

	server.registerTool(
		'set_photos_favorite',
		{
			title: 'Favourite or unfavourite photos',
			description: 'Makes photos favourites, or with `favorite: false` no longer favourites.',
			inputSchema: z.object({photoIds, favorite: z.boolean()}),
			annotations: ARRANGE,
		},
		(input) =>
			runTool(context, 'set_photos_favorite', input, async () => {
				await context.mcp.assertPhotosAccess()
				return {changed: await photos.items.setFavorite({ids: input.photoIds, favorite: input.favorite})}
			}),
	)

	server.registerTool(
		'trash_photos',
		{
			title: 'Move photos to Recently Deleted',
			description:
				'Moves photos and videos to Recently Deleted, which moves their files to the Trash. They can be put back with restore_photos. Nothing is deleted for good through MCP. Ask the user before removing photos they did not name.',
			inputSchema: z.object({photoIds}),
			annotations: {...REMOVE, idempotentHint: false},
		},
		(input) =>
			runTool(context, 'trash_photos', input, async () => {
				await context.mcp.assertPhotosAccess()
				return {moved: await photos.items.delete({ids: input.photoIds})}
			}),
	)

	server.registerTool(
		'restore_photos',
		{
			title: 'Put photos back from Recently Deleted',
			description:
				'Puts photos and videos in Recently Deleted (list_photos with `deleted`) back where they were in the library.',
			inputSchema: z.object({photoIds}),
			annotations: {...ARRANGE, idempotentHint: false},
		},
		(input) =>
			runTool(context, 'restore_photos', input, async () => {
				await context.mcp.assertPhotosAccess()
				return {restored: await photos.items.restore({ids: input.photoIds})}
			}),
	)

	server.registerTool(
		'list_albums',
		{
			title: 'List albums',
			description: "The owner's albums, each with how many photos it has and when they were taken.",
			inputSchema: z.object({}),
			annotations: READ,
		},
		(input) =>
			runTool(context, 'list_albums', input, async () => {
				await context.mcp.assertPhotosAccess()
				return {albums: (await photos.albums.list()).map(albumDto)}
			}),
	)

	server.registerTool(
		'create_album',
		{
			title: 'Create album',
			description:
				'Makes a new album, with the photos given in it. Find the photos first with search_files (scope photos) or list_photos, a page at a time where there are many, and add what is left with add_photos_to_album. An album only gathers photos: it copies and moves nothing.',
			inputSchema: z.object({name: z.string().trim().min(1).max(200), photoIds: photoIds.optional()}),
			annotations: {...ARRANGE, idempotentHint: false},
		},
		(input) =>
			runTool(context, 'create_album', input, async () => {
				await context.mcp.assertPhotosAccess()
				return albumDto(
					await photos.albums.create({name: input.name, ...(input.photoIds ? {ids: input.photoIds} : {})}),
				)
			}),
	)

	server.registerTool(
		'update_album',
		{
			title: 'Rename album or set its cover',
			description: 'Gives an album another name, a photo of it for its cover, or both.',
			inputSchema: z.object({
				albumId: z.string(),
				name: z.string().trim().min(1).max(200).optional(),
				coverPhotoId: z.string().optional().describe('A photo in the album to show for it.'),
			}),
			annotations: ARRANGE,
		},
		(input) =>
			runTool(context, 'update_album', input, async () => {
				await context.mcp.assertPhotosAccess()
				if (input.name === undefined && input.coverPhotoId === undefined) {
					throw new Error('[invalid-input] Give a name, a coverPhotoId, or both.')
				}
				if (input.name !== undefined) await photos.albums.rename({id: input.albumId, name: input.name})
				if (input.coverPhotoId !== undefined) {
					await photos.albums.setCover({id: input.albumId, itemId: input.coverPhotoId})
				}
				const album = (await photos.albums.list()).find(({id}) => id === input.albumId)
				if (!album) throw new Error('[not-found] There is no album with that id.')
				return albumDto(album)
			}),
	)

	server.registerTool(
		'add_photos_to_album',
		{
			title: 'Add photos to album',
			description: 'Adds photos to an album. Ones already in it stay as they are.',
			inputSchema: z.object({albumId: z.string(), photoIds}),
			annotations: ARRANGE,
		},
		(input) =>
			runTool(context, 'add_photos_to_album', input, async () => {
				await context.mcp.assertPhotosAccess()
				return {added: await photos.albums.addItems({id: input.albumId, ids: input.photoIds})}
			}),
	)

	server.registerTool(
		'remove_photos_from_album',
		{
			title: 'Remove photos from album',
			description: 'Takes photos out of an album. They stay in the library.',
			inputSchema: z.object({albumId: z.string(), photoIds}),
			annotations: ARRANGE,
		},
		(input) =>
			runTool(context, 'remove_photos_from_album', input, async () => {
				await context.mcp.assertPhotosAccess()
				return {removed: await photos.albums.removeItems({id: input.albumId, ids: input.photoIds})}
			}),
	)

	server.registerTool(
		'delete_album',
		{
			title: 'Delete album',
			description:
				'Deletes an album. The photos in it stay in the library; the album itself cannot be brought back, so ask the user first.',
			inputSchema: z.object({albumId: z.string()}),
			annotations: REMOVE,
		},
		(input) =>
			runTool(context, 'delete_album', input, async () => {
				await context.mcp.assertPhotosAccess()
				await photos.albums.delete({id: input.albumId})
				return {deleted: input.albumId}
			}),
	)

	server.registerTool(
		'list_people',
		{
			title: 'List people',
			description:
				'The people Photos has recognised in the library, with the name the owner gave each and how many photos they are in. Someone with no name has not been named yet. Use a personId to narrow list_photos or search_files to who is in a photo.',
			inputSchema: z.object({hidden: z.boolean().optional().describe('List the people the owner has hidden.')}),
			annotations: READ,
		},
		(input) =>
			runTool(context, 'list_people', input, async () => {
				await context.mcp.assertPhotosAccess()
				const people = await photos.people.list({hidden: input.hidden ?? false})
				return {
					people: people.map(({id, name, count, isHidden}) => ({
						personId: id,
						...(name ? {name} : {}),
						photos: count,
						...(isHidden ? {hidden: true} : {}),
					})),
				}
			}),
	)

	server.registerTool(
		'update_person',
		{
			title: 'Name or hide a person',
			description:
				'Gives someone Photos has recognised a name (an empty name takes it away), or hides them from People or shows them again. Only name someone the user has told you is in a photo you can tell them by, never by how they look (get_photo says who is in one).',
			inputSchema: z.object({
				personId: z.string(),
				name: z.string().trim().max(100).optional(),
				hidden: z.boolean().optional(),
			}),
			annotations: ARRANGE,
		},
		(input) =>
			runTool(context, 'update_person', input, async () => {
				await context.mcp.assertPhotosAccess()
				if (input.name === undefined && input.hidden === undefined) {
					throw new Error('[invalid-input] Give a name, hidden, or both.')
				}
				if (input.name !== undefined) await photos.people.rename({id: input.personId, name: input.name})
				if (input.hidden !== undefined) await photos.people.setHidden({id: input.personId, hidden: input.hidden})
				return {personId: input.personId}
			}),
	)

	server.registerTool(
		'merge_people',
		{
			title: 'Merge people',
			description:
				'Makes several people Photos has told apart one person, for when they are the same person: `into` keeps its name and takes the photos of the others. It cannot be undone, so only do it when the user has said they are the same person.',
			inputSchema: z.object({
				into: z.string().describe('The person to keep.'),
				personIds: z.array(z.string()).min(1).max(50).describe('The people to fold into them.'),
			}),
			annotations: {...REMOVE, idempotentHint: false},
		},
		(input) =>
			runTool(context, 'merge_people', input, async () => {
				await context.mcp.assertPhotosAccess()
				await photos.people.merge({into: input.into, ids: input.personIds})
				return {personId: input.into}
			}),
	)
}
