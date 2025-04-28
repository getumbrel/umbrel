import {useMemo} from 'react'
import {useNavigate} from 'react-router-dom'

import {CmdkSearchProviderProps} from '@/components/cmdk-providers'
import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {BASE_ROUTE_PATH} from '@/features/files/constants'
import {useSearchFiles} from '@/features/files/hooks/use-search-files'
import {useFilesStore} from '@/features/files/store/use-files-store'
import {FileSystemItem} from '@/features/files/types'
import {formatItemName} from '@/features/files/utils/format-filesystem-name'
import {CommandItem} from '@/shadcn-components/ui/command'
import {t} from '@/utils/i18n'

// how many max results we want to show in the command-k
const MAX_RESULTS = 10

export const FilesCmdkSearchProvider: React.FC<CmdkSearchProviderProps> = ({query, close}) => {
	const navigate = useNavigate()
	const trimmedQuery = query.trim()
	const setViewerItem = useFilesStore((state) => state.setViewerItem)
	const setSelectedItems = useFilesStore((state) => state.setSelectedItems)

	const {results, isLoading} = useSearchFiles(trimmedQuery)

	// we memoise a slice of the results just so we don't constantly re-create the
	// array on every keystroke
	const topResults = useMemo(() => results.slice(0, MAX_RESULTS), [results])

	// return early if there is no query
	if (trimmedQuery.length === 0) return null

	// TODO: Use the new navigateToItem function
	const openFile = (item: FileSystemItem) => {
		// folders can be navigated to directly
		if (item.type === 'directory') {
			navigate(`${BASE_ROUTE_PATH}${item.path}`)
			close()
			return
		}

		// for files we navigate to their parent directory and trigger the viewer
		// so the user can immediately preview/download the file
		const lastSlash = item.path.lastIndexOf('/')
		const parentPath = lastSlash === 0 ? '' : item.path.slice(0, lastSlash)

		navigate(`${BASE_ROUTE_PATH}${parentPath}`)

		// open viewer via global store (the Files feature will render the viewer
		// component once it sees `viewerItem` being set)
		setViewerItem(item)

		// TODO: This is a hack since we set selected items to []
		// on path change in packages/ui/src/features/files/index.tsx
		// so we wait 100ms for the path change to complete => setSelectedItems([])
		// to execute, and then set the selected item
		setTimeout(() => {
			setSelectedItems([item])
		}, 100)

		// close the command-k
		close()
	}

	if (isLoading || topResults.length === 0) return null

	return topResults.map((item, idx) => (
		<CommandItem
			key={item.path + idx}
			icon={<FileItemIcon item={item} className='h-full w-full' onlySVG />}
			value={item.name}
			onSelect={() => openFile(item)}
		>
			<span>
				{formatItemName({name: item.name, maxLength: 40})} <span className='opacity-50'>{t('generic-in')} Files</span>
			</span>
		</CommandItem>
	))
}
