import {useMutation} from '@tanstack/react-query'

import {batchesOf, inBatches} from '@/features/photos/hooks/batches'
import {useItemCache} from '@/features/photos/hooks/use-items'
import {RouterOutput, trpcReact} from '@/trpc/trpc'

export type Album = RouterOutput['photos']['albums']['list'][number]
export type LibrarySummary = RouterOutput['photos']['library']['summary']

type QueryOptions = {enabled?: boolean}
export const useLibrarySummary = () => trpcReact.photos.library.summary.useQuery()
export const useLibraryStatus = () => trpcReact.photos.library.status.useQuery()
export const useAlbums = (options?: QueryOptions) => trpcReact.photos.albums.list.useQuery(undefined, options)
// People and Locations are cut from v1 — usePeople/useLocations (and their
// Person/Location types) come back with the photos.people/locations routers

export function useAlbumActions() {
	const utils = trpcReact.useUtils()
	const {remove: dropFromLists} = useItemCache()
	// Everything of Photos' but its item lists, which are only marked stale:
	// they are refreshed where that is safe (see "Keeping a list up to date"
	// in use-items.ts), and none of these changes alters the list on screen
	// beyond what was already taken out of it
	const refresh = () => utils.photos.invalidate()
	const albums = utils.client.photos.albums
	// A selection of any size goes to the server a batch at a time (see
	// batches.ts): an album made from one is made with its first batch, and
	// takes the rest as additions. Read again whether or not all of it got there.
	const create = useMutation({
		mutationFn: async ({name, ids}: {name: string; ids?: string[]}) => {
			const [first, ...rest] = batchesOf(ids ?? [])
			const album = await albums.create.mutate({name, ids: first})
			for (const batch of rest) await albums.addItems.mutate({id: album.id, ids: batch})
			return album
		},
		onSettled: refresh,
	})
	const rename = trpcReact.photos.albums.rename.useMutation({onSuccess: refresh})
	const setCover = trpcReact.photos.albums.setCover.useMutation({onSuccess: refresh})
	const remove = trpcReact.photos.albums.delete.useMutation({onSuccess: refresh})
	const addItems = useMutation({
		mutationFn: ({id, ids}: {id: string; ids: string[]}) =>
			inBatches(ids, (batch) => albums.addItems.mutate({id, ids: batch})),
		onSettled: refresh,
	})
	// The items leave the album's list at once, and its count with them; its
	// cover follows with the refresh, which also puts the count right
	const removeItems = useMutation({
		mutationFn: ({id, ids}: {id: string; ids: string[]}) =>
			inBatches(ids, (batch) => albums.removeItems.mutate({id, ids: batch})),
		onMutate: ({id, ids}) => {
			dropFromLists(ids, (filter) => filter.albumIds?.includes(id) ?? false)
			utils.photos.albums.list.setData(undefined, (albums) =>
				albums?.map((album) => (album.id === id ? {...album, count: Math.max(0, album.count - ids.length)} : album)),
			)
		},
		onSuccess: refresh,
		onError: refresh,
	})
	return {
		createAlbum: create.mutateAsync,
		renameAlbum: rename.mutateAsync,
		setCover: setCover.mutateAsync,
		deleteAlbum: remove.mutateAsync,
		addToAlbum: addItems.mutateAsync,
		removeFromAlbum: removeItems.mutateAsync,
	}
}
