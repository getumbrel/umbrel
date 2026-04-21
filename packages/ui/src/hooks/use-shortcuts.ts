import {trpcReact, type RouterOutput} from '@/trpc/trpc'

export type Shortcut = RouterOutput['shortcuts']['list'][number]

export function useShortcuts() {
	const utils = trpcReact.useUtils()

	const listQuery = trpcReact.shortcuts.list.useQuery(undefined, {
		staleTime: Infinity,
	})

	const addMutation = trpcReact.shortcuts.add.useMutation({
		onSuccess: () => utils.shortcuts.list.invalidate(),
	})

	const removeMutation = trpcReact.shortcuts.remove.useMutation({
		onSuccess: () => utils.shortcuts.list.invalidate(),
	})

	return {
		shortcuts: listQuery.data,
		isLoading: listQuery.isLoading,
		addAsync: addMutation.mutateAsync,
		isAdding: addMutation.isPending,
		remove: removeMutation.mutate,
		isRemoving: removeMutation.isPending,
	}
}
