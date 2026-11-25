import {X} from 'lucide-react'
import {useTranslation} from 'react-i18next'
import {useLocation} from 'react-router-dom'

import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {BASE_ROUTE_PATH, RECENTS_PATH, SEARCH_PATH, SYSTEM_MANAGED_ROOT_PATHS} from '@/features/files/constants'
import {useFilesOperations} from '@/features/files/hooks/use-files-operations'
import {useListDirectory} from '@/features/files/hooks/use-list-directory'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {useFilesStore} from '@/features/files/store/use-files-store'
import {cn} from '@/lib/utils'
import {formatNumberI18n} from '@/utils/number'

// Whether Files is holding something to paste, and is on screen to paste it into
export function useShowClipboardIsland() {
	const hasItems = useFilesStore((state) => state.clipboardItems.length > 0)
	const {pathname} = useLocation()
	return hasItems && (pathname === BASE_ROUTE_PATH || pathname.startsWith(`${BASE_ROUTE_PATH}/`))
}

// What has been copied or cut, kept in sight until it is put somewhere. The
// clipboard was something you had to remember you were holding, and on a
// phone pasting was three taps into a menu. Now the island says what is held,
// follows from folder to folder, and one tap puts it in the folder on screen.
// Where nothing can be pasted (a search's results, a read-only folder) it
// waits, dimmed, for a folder that can take it. The × lets go of it.
export function ClipboardIsland() {
	const {t, i18n} = useTranslation()
	const items = useFilesStore((state) => state.clipboardItems)
	const mode = useFilesStore((state) => state.clipboardMode)
	const clearClipboard = useFilesStore((state) => state.clearClipboard)
	const {currentPath} = useNavigate()
	const {pasteItemsFromClipboard} = useFilesOperations()

	// Recents and search aren't folders, and umbrelOS keeps /Apps and /Machines to itself
	const isFolder =
		currentPath !== RECENTS_PATH && currentPath !== SEARCH_PATH && !SYSTEM_MANAGED_ROOT_PATHS.has(currentPath)
	const {listing} = useListDirectory(currentPath, {enabled: isFolder})
	// Not into the folder the items are already in (a cut would do nothing), nor into one of themselves
	const isSource =
		mode === 'cut' && items.every((item) => item.path.slice(0, item.path.lastIndexOf('/')) === currentPath)
	const isInsideItself = items.some((item) => currentPath === item.path || currentPath.startsWith(`${item.path}/`))
	const canPaste = isFolder && !isSource && !isInsideItself && (listing?.operations.includes('writable') ?? false)

	const [first] = items
	if (!first) return null
	const count = items.length
	const formattedCount = formatNumberI18n({n: count, showDecimals: false, locale: i18n.language})
	const label =
		mode === 'cut'
			? t('files-clipboard.move-here', {count, formattedCount})
			: t('files-clipboard.paste-here', {count, formattedCount})

	return (
		// An island's sizes are fixed, so its text keeps its size whatever the text size setting
		<div className='flex h-10 max-w-[calc(100vw-16px)] items-center rounded-[22px] bg-black text-white shadow-floating-island [--text-boost:0px]'>
			<button
				type='button'
				disabled={!canPaste}
				onClick={() => void pasteItemsFromClipboard({toDirectory: currentPath})}
				className={cn(
					'flex h-full min-w-0 items-center gap-2 rounded-l-[22px] pr-2.5 pl-2.5 outline-hidden transition-opacity duration-200 focus-visible:bg-white/10 active:opacity-70',
					!canPaste && 'opacity-45',
				)}
			>
				<span className='relative flex size-6 shrink-0 items-center justify-center'>
					<FileItemIcon item={first} className='size-6' thumbnailFit='hug' showBadges={false} />
				</span>
				<span className='min-w-0 truncate text-12 font-medium -tracking-2'>{label}</span>
			</button>
			<span aria-hidden className='h-4 w-px shrink-0 bg-white/15' />
			<button
				type='button'
				aria-label={t('files-clipboard.clear')}
				onClick={clearClipboard}
				className='flex h-full shrink-0 items-center rounded-r-[22px] pr-3 pl-2.5 text-white/60 outline-hidden transition-colors hover:text-white focus-visible:bg-white/10 active:opacity-70'
			>
				<X className='size-3.5' strokeWidth={2.5} />
			</button>
		</div>
	)
}
