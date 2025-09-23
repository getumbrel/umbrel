import {Pencil} from 'lucide-react'
import {useState} from 'react'

import {PathBarDesktop} from '@/features/files/components/listing/actions-bar/path-bar/path-bar-desktop'
import {PathBarMobile} from '@/features/files/components/listing/actions-bar/path-bar/path-bar-mobile'
import {PathInput} from '@/features/files/components/listing/actions-bar/path-bar/path-input'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger} from '@/shadcn-components/ui/context-menu'
import {t} from '@/utils/i18n'

export function PathBar() {
	const {uiPath} = useNavigate()
	const [isEditing, setIsEditing] = useState(false)
	const isMobile = useIsMobile()

	const handleEdit = () => setIsEditing(true)

	return (
		<ContextMenu>
			<ContextMenuTrigger className='w-0 flex-1'>
				<PathBarContent
					isEditing={isEditing}
					isMobile={isMobile}
					currentPath={uiPath}
					onInputClose={() => setIsEditing(false)}
				/>
			</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem onSelect={handleEdit}>
					<Pencil className='mr-2 h-3 w-3' />
					{t('files-action.go-to-path')}
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	)
}

const PathBarContent = ({
	isEditing,
	isMobile,
	currentPath,
	onInputClose,
}: {
	isEditing: boolean
	isMobile: boolean
	currentPath: string
	onInputClose: () => void
}) => {
	if (isEditing) {
		return <PathInput path={currentPath} onClose={onInputClose} />
	}

	if (isMobile) {
		return <PathBarMobile path={currentPath} />
	}

	return <PathBarDesktop path={currentPath} />
}
