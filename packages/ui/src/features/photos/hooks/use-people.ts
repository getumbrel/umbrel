import {useQueryClient, type QueryClient} from '@tanstack/react-query'
import {getQueryKey} from '@trpc/react-query'
import {useMemo} from 'react'

import {useItemCache} from '@/features/photos/hooks/use-items'
import {RouterOutput, trpcReact} from '@/trpc/trpc'

// Someone Photos has recognised across the library; unnamed until the user
// says who it is
export type Person = RouterOutput['photos']['people']['list'][number]

// The people worth showing first: those with names, then the faces seen most
export function sortPeople(people: readonly Person[]): Person[] {
	return [...people].sort((a, b) => Number(Boolean(b.name)) - Number(Boolean(a.name)) || b.count - a.count)
}

// Someone else already going by this name — naming a second person the same
// is almost always the same person recognised twice, so the UI offers to
// merge instead of making a duplicate
export function findNamesake(people: readonly Person[], name: string, exceptId: string) {
	const wanted = name.trim().toLocaleLowerCase()
	if (!wanted) return undefined
	return people.find((person) => person.id !== exceptId && person.name?.trim().toLocaleLowerCase() === wanted)
}

// The one a merge keeps: a name outranks none, then whoever is in more
// photos — their name and their page are what survive
export function mergeTarget(people: readonly Person[]) {
	return sortPeople(people)[0]
}

// The visible people (or the hidden ones), in display order
export function usePeople({hidden = false, enabled = true}: {hidden?: boolean; enabled?: boolean} = {}) {
	const query = trpcReact.photos.people.list.useQuery({hidden}, {enabled})
	const people = useMemo(() => sortPeople(query.data ?? []), [query.data])
	return {people, isLoading: query.isLoading, isError: query.isError, refetch: query.refetch}
}

export function usePerson(id: string | undefined) {
	const {people} = usePeople({enabled: id !== undefined})
	// A hidden person's page is still reachable (from the hidden shelf)
	const hidden = usePeople({hidden: true, enabled: id !== undefined && !people.some((person) => person.id === id)})
	return id === undefined ? undefined : (people.find((p) => p.id === id) ?? hidden.people.find((p) => p.id === id))
}

// "Is this also Anna?": someone unnamed whom recognition takes for someone
// named, seen at another age or from another side
export type PersonSuggestion = RouterOutput['photos']['people']['suggestions'][number]

// The questions worth asking, likeliest first. Answering one takes it off
// the list at once: yes is a merge (usePeopleActions), no is `dismiss`,
// after which recognition never offers the two as one again.
export function usePersonSuggestions({enabled = true}: {enabled?: boolean} = {}) {
	const queryClient = useQueryClient()
	const utils = trpcReact.useUtils()
	const query = trpcReact.photos.people.suggestions.useQuery(undefined, {enabled})
	const answered = async (candidateId: string) => {
		// A read already on its way would bring the question back
		await utils.photos.people.suggestions.cancel()
		utils.photos.people.suggestions.setData(undefined, (suggestions) =>
			suggestions?.filter((suggestion) => suggestion.candidate.id !== candidateId),
		)
	}
	const dismiss = trpcReact.photos.people.dismissSuggestion.useMutation({
		onMutate: ({candidateId}) => answered(candidateId),
		onSettled: () => {
			if (isLastToSettle(queryClient)) void utils.photos.people.invalidate()
		},
	})
	return {suggestions: query.data ?? [], answered, dismiss: dismiss.mutateAsync}
}

const PEOPLE_KEY = getQueryKey(trpcReact.photos.people)
const PEOPLE_LIST_KEY = getQueryKey(trpcReact.photos.people.list)
// Whether the change now settling is the only one still on its way (it
// counts itself until it has settled). A read asked for while another is
// under way comes back without that one and undoes it on screen, so the last
// change to settle does the reading for all of them.
const isLastToSettle = (queryClient: QueryClient) => queryClient.isMutating({mutationKey: PEOPLE_KEY}) === 1
const listsHidden = (queryKey: readonly unknown[]) =>
	(queryKey[1] as {input?: {hidden?: boolean}} | undefined)?.input?.hidden ?? false

// Every change shows at once in the cached lists and is confirmed (or put
// right) by the refetch that follows — a name typed under a face must not
// wait on a round trip to appear. A read begun before the change would put
// the lists back as they were, so each change first cancels those under way.
export function usePeopleActions() {
	const queryClient = useQueryClient()
	const utils = trpcReact.useUtils()
	const {remove: dropFromLists} = useItemCache()
	// Rewrites both cached lists; `hidden` says which one is being rewritten
	const rewrite = (update: (people: Person[], hidden: boolean) => Person[]) => {
		for (const [queryKey] of queryClient.getQueriesData<Person[]>({queryKey: PEOPLE_LIST_KEY})) {
			queryClient.setQueryData<Person[]>(queryKey, (people) => people && update(people, listsHidden(queryKey)))
		}
	}
	const known = () =>
		queryClient.getQueriesData<Person[]>({queryKey: PEOPLE_LIST_KEY}).flatMap(([, people]) => people ?? [])
	const refresh = () => {
		if (isLastToSettle(queryClient)) void utils.photos.people.invalidate()
		// A lightbox's "who is in this" carries names too
		void utils.photos.items.get.invalidate()
	}
	const settle = {onSettled: refresh}

	const rename = trpcReact.photos.people.rename.useMutation({
		onMutate: async ({id, name}) => {
			await utils.photos.people.list.cancel()
			rewrite((people) => people.map((p) => (p.id === id ? {...p, name: name.trim() || undefined} : p)))
		},
		...settle,
	})
	const merge = trpcReact.photos.people.merge.useMutation({
		onMutate: async ({into, ids}) => {
			await utils.photos.people.list.cancel()
			const gone = new Set(ids)
			// Their photos join the survivor's; the true count (some photos hold
			// both) arrives with the refetch
			const gained = known().reduce((sum, p) => (gone.has(p.id) ? sum + p.count : sum), 0)
			rewrite((people) =>
				people.filter((p) => !gone.has(p.id)).map((p) => (p.id === into ? {...p, count: p.count + gained} : p)),
			)
		},
		onSettled: () => {
			refresh()
			// The merged-away person's timeline is the survivor's now, and so is
			// every search that was narrowed to either of them
			void utils.photos.items.list.invalidate()
			void utils.search.query.invalidate()
		},
	})
	const setHidden = trpcReact.photos.people.setHidden.useMutation({
		onMutate: async ({id, hidden}) => {
			await utils.photos.people.list.cancel()
			const person = known().find((p) => p.id === id)
			rewrite((people, listHidden) => {
				const rest = people.filter((p) => p.id !== id)
				return person && listHidden === hidden ? [...rest, {...person, isHidden: hidden}] : rest
			})
		},
		...settle,
	})
	const setCover = trpcReact.photos.people.setCover.useMutation(settle)
	// "This isn't them": the items leave the person's timeline at once
	const removeItems = trpcReact.photos.people.removeItems.useMutation({
		onMutate: ({id, ids}) => dropFromLists(ids, (filter) => filter.personIds?.includes(id) ?? false),
		onSettled: () => {
			refresh()
			void utils.photos.items.list.invalidate()
			// A ranked search of their photos lost the items too (see
			// useItemCache.remove) and, had this failed, must get them back
			void utils.search.query.invalidate()
		},
	})
	return {
		renamePerson: rename.mutateAsync,
		mergePeople: merge.mutateAsync,
		setPersonHidden: setHidden.mutateAsync,
		setPersonCover: setCover.mutateAsync,
		removeFromPerson: removeItems.mutateAsync,
	}
}
