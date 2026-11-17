import {Pencil} from 'lucide-react'
import {useState} from 'react'
import {useTranslation} from 'react-i18next'

import {ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger} from '@/components/ui/context-menu'
import {PathCrumbs} from '@/features/files/components/listing/actions-bar/path-bar/path-crumbs'
import {PathInput} from '@/features/files/components/listing/actions-bar/path-bar/path-input'
import {PathTitle} from '@/features/files/components/listing/actions-bar/path-bar/path-title'
import {useNavigate} from '@/features/files/hooks/use-navigate'

// Where Files is, as the bar's title: the whole way down from the root where
// there is room for it (PathCrumbs), the current folder's name on a phone
// (PathTitle). Right-clicking it offers to type a path instead.
export function PathBar({compact}: {compact: boolean}) {
	const {t} = useTranslation()
	const {uiPath} = useNavigate()
	const [isEditing, setIsEditing] = useState(false)

	return (
		<ContextMenu>
			<ContextMenuTrigger className='block min-w-0'>
				{isEditing ? (
					<PathInput path={uiPath} onClose={() => setIsEditing(false)} />
				) : compact ? (
					<PathTitle />
				) : (
					<PathCrumbs />
				)}
			</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem onSelect={() => setIsEditing(true)}>
					<Pencil className='mr-2 h-3 w-3' />
					{t('files-action.go-to-path')}
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	)
}
