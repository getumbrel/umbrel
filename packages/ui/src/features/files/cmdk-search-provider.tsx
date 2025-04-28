import {useMemo} from 'react'

import {CmdkSearchProviderProps} from '@/components/cmdk-providers'
import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {useSearchFiles} from '@/features/files/hooks/use-search-files'
import {formatItemName} from '@/features/files/utils/format-filesystem-name'
import {CommandItem} from '@/shadcn-components/ui/command'
import {t} from '@/utils/i18n'

// how many max results we want to show in the command-k
const MAX_RESULTS = 10

export const FilesCmdkSearchProvider: React.FC<CmdkSearchProviderProps> = ({query, close}) => {
	const {navigateToItem} = useNavigate()
	const trimmedQuery = query.trim()

	const {results, isLoading} = useSearchFiles(trimmedQuery)

	// we memoise a slice of the results just so we don't constantly re-create the
	// array on every keystroke
	const topResults = useMemo(() => results.slice(0, MAX_RESULTS), [results])

	// return early if there is no query
	if (trimmedQuery.length === 0) return null

	if (isLoading || topResults.length === 0) return null

	return topResults.map((item) => (
		<CommandItem
			key={item.path}
			icon={<FileItemIcon item={item} className='h-full w-full' />}
			value={item.path}
			onSelect={() => {
				navigateToItem(item)
				close()
			}}
		>
			<span>
				{formatItemName({name: item.name, maxLength: 40})} <span className='opacity-50'>{t('generic-in')} Files</span>
			</span>
		</CommandItem>
	))
}
