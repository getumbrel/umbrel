// This EmbeddedFiles component is a wrapper we use to embed the Files UI inside other features (e.g., Rewind feature).
// It gets its own navigation state and capabilities via FilesCapabilitiesProvider (instead of the router).
// We currently use it in Rewind feature with read-only mode and path aliasing.

import {useState} from 'react'
import {HiMenuAlt2} from 'react-icons/hi'

import {FileViewer} from '@/features/files/components/file-viewer'
import {ActionsBar} from '@/features/files/components/listing/actions-bar'
import {ActionsBarProvider} from '@/features/files/components/listing/actions-bar/actions-bar-context'
import {DirectoryListing} from '@/features/files/components/listing/directory-listing'
import {Sidebar} from '@/features/files/components/sidebar'
import {MobileSidebarWrapper} from '@/features/files/components/sidebar/mobile-sidebar-wrapper'
import {HOME_PATH} from '@/features/files/constants'
import {FilesCapabilitiesProvider} from '@/features/files/providers/files-capabilities-context'
import {useIsMobile} from '@/hooks/use-is-mobile'

export function EmbeddedFiles({
	mode = 'read-only',
	initialPath = HOME_PATH,
	onNavigate,
	className = '',
	pathAliases,
	currentPath: controlledPath,
	explorerScale = 1,
}: {
	mode?: 'full' | 'read-only'
	initialPath?: string
	onNavigate?: (path: string) => void
	className?: string
	pathAliases?: Record<string, string>
	currentPath?: string
	explorerScale?: number
}) {
	const [path, setPath] = useState(initialPath)
	const isMobile = useIsMobile()
	const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false)

	// Always update local path state on navigation; notify external listener if provided.
	const handleNavigate = (nextPath: string) => {
		if (controlledPath === undefined) setPath(nextPath)
		onNavigate?.(nextPath)
	}

	return (
		<FilesCapabilitiesProvider
			value={{
				mode,
				currentPath: controlledPath ?? path,
				onNavigate: handleNavigate,
				// Forward optional aliasing so nested consumers (like use-navigate)
				// can transparently remap logical roots to alternate physical roots.
				pathAliases,
				hiddenSidebarItems:
					mode === 'read-only' ? {network: true, external: true, trash: true, rewind: true} : undefined,
			}}
		>
			<div className={['grid grid-cols-1 lg:grid-cols-[188px_1fr]', className].join(' ')}>
				{/* We still render viewer so you can see past files easily (read-only safe) */}
				<FileViewer />
				{isMobile ? (
					<MobileSidebarWrapper isOpen={isMobileSidebarOpen} onClose={() => setIsMobileSidebarOpen(false)}>
						<Sidebar className='h-[calc(100svh-140px)]' />
					</MobileSidebarWrapper>
				) : (
					<Sidebar className='h-[calc(100vh-300px)]' />
				)}
				<div className='flex flex-col gap-3 lg:gap-6'>
					<ActionsBarProvider>
						{/* Mobile-only sidebar toggle */}
						{isMobile ? (
							<div className='flex items-center gap-3 px-2'>
								<HiMenuAlt2
									role='button'
									className='h-5 w-5 cursor-pointer text-white/90'
									onClick={() => setIsMobileSidebarOpen(true)}
								/>
							</div>
						) : null}
						<ActionsBar />
						{/* The marquee overlay assumes unscaled coordinates, so pass the applied explorer scale
						 * (used by SnapshotCarousel) down so selection stays aligned. */}
						<DirectoryListing marqueeScale={explorerScale} />
					</ActionsBarProvider>
				</div>
			</div>
		</FilesCapabilitiesProvider>
	)
}
