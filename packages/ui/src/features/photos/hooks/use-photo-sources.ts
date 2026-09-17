import {useHomeDirectoryName} from '@/features/files/hooks/use-home-directory-name'
import {RouterOutput, trpcReact} from '@/trpc/trpc'

export type PhotoSource = RouterOutput['photos']['sources']['list'][number]
export type SourceType = PhotoSource['type']
export type SourceSettings = {scope: NonNullable<PhotoSource['scope']>}
export type ImportScopeMode = SourceSettings['scope']['mode']

// This Umbrel is scanned by umbrelOS; phones push through the Umbrel app and
// keep their settings on the device.
export function sourceKind(type: SourceType): 'push' | 'pull' {
	return type === 'iphone' ? 'push' : 'pull'
}

export function usePhotoSources() {
	// Present the built-in Umbrel source with the same account name Files uses.
	const homeDirectoryName = useHomeDirectoryName()
	const query = trpcReact.photos.sources.list.useQuery()
	return {
		sources: (query.data ?? []).map((source) =>
			source.type === 'umbrel' ? {...source, name: homeDirectoryName} : source,
		),
		isLoading: query.isLoading,
		error: query.error,
	}
}

export function usePhotoSource(id: string | undefined) {
	const {sources, isLoading} = usePhotoSources()
	return {source: id ? sources.find((source) => source.id === id) : undefined, isLoading}
}

export function usePhotoSourceActions() {
	const utils = trpcReact.useUtils()
	const update = trpcReact.photos.sources.update.useMutation({onSuccess: () => utils.photos.sources.invalidate()})
	const rename = trpcReact.photos.sources.rename.useMutation({onSuccess: () => utils.photos.sources.invalidate()})
	const remove = trpcReact.photos.sources.remove.useMutation({onSuccess: () => utils.photos.invalidate()})

	return {
		updateSettings: ({id, settings}: {id: string; settings: Partial<SourceSettings>}) =>
			update.mutateAsync({id, ...settings}),
		renameSource: rename.mutateAsync,
		isRenaming: rename.isPending,
		removeSource: remove.mutateAsync,
		isRemoving: remove.isPending,
	}
}
