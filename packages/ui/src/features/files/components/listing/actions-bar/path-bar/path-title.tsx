import {Check, ChevronDown} from 'lucide-react'
import {useTranslation} from 'react-i18next'

import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from '@/components/ui/dropdown-menu'
import {pathFocusClass, useMenuFocusReturn} from '@/features/files/components/listing/actions-bar/path-bar/path-focus'
import {
	segmentIconItem,
	usePathSegments,
	type PathSegment,
} from '@/features/files/components/listing/actions-bar/path-bar/use-path-segments'
import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {MachineFolderMetadata} from '@/features/files/hooks/use-machine-folder'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {formatItemName} from '@/features/files/utils/format-filesystem-name'
import {cn} from '@/lib/utils'

// Where Files is, on a screen too narrow for the whole path: the current
// folder's name as the bar's title. Inside a folder the name opens the way
// back up, every folder above it down to the root, so any of them is one tap
// away however deep the folder is.
export function PathTitle() {
	const {t} = useTranslation()
	const {navigateToDirectory} = useNavigate()
	const segments = usePathSegments()
	const current = segments[segments.length - 1]
	const menuFocus = useMenuFocusReturn()

	const title = (
		<MachineFolderMetadata path={current.path}>
			{({machine}) => (
				<span className='min-w-0 truncate'>
					{machine
						? machine.name
						: // A search's title is a sentence, and reads whole
							current.type === 'search'
							? current.segment
							: formatItemName({name: current.segment, maxLength: 40})}
				</span>
			)}
		</MachineFolderMetadata>
	)

	if (segments.length < 2) return <h2 className={titleClass}>{title}</h2>

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				aria-label={t('files-path.show-path', {name: current.segment})}
				className={cn(
					titleClass,
					'group -mx-1 max-w-full rounded-6 px-1 text-left',
					pathFocusClass,
					'focus-visible:text-white',
				)}
				{...menuFocus.trigger}
			>
				<h2 className='flex min-w-0 items-center'>{title}</h2>
				<ChevronDown
					className='mt-px size-3.5 shrink-0 text-white/40 transition-transform duration-200 group-data-[state=open]:rotate-180'
					strokeWidth={2.5}
					aria-hidden
				/>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align='start'
				className='max-w-[min(20rem,calc(100vw-24px))] min-w-52'
				{...menuFocus.content}
			>
				{/* The folder on screen first, then each one above it, up to the root */}
				{[...segments].reverse().map((segment, index) => (
					<PathMenuItem
						key={segment.id}
						segment={segment}
						isCurrent={index === 0}
						onSelect={() => navigateToDirectory(segment.path)}
					/>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

const titleClass = 'flex min-w-0 items-center gap-1 text-17 leading-tight font-semibold -tracking-2 text-white/90'

function PathMenuItem({
	segment,
	isCurrent,
	onSelect,
}: {
	segment: PathSegment
	isCurrent: boolean
	onSelect: () => void
}) {
	return (
		<MachineFolderMetadata path={segment.path}>
			{({machine}) => (
				<DropdownMenuItem onSelect={isCurrent ? undefined : onSelect} className='gap-2.5 py-2.5'>
					<FileItemIcon
						item={segmentIconItem(segment)}
						className='size-5 shrink-0'
						machine={machine ?? null}
						showBadges={false}
					/>
					<span className={cn('min-w-0 flex-1 truncate', isCurrent && 'text-white')}>
						{machine ? machine.name : segment.segment}
					</span>
					{isCurrent && <Check className='size-4 shrink-0 text-white/60' aria-hidden />}
				</DropdownMenuItem>
			)}
		</MachineFolderMetadata>
	)
}
