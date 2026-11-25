import {motion} from 'motion/react'
import {useEffect, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {useLocation, useNavigate} from 'react-router-dom'

import {ChevronLeftIcon} from '@/features/files/assets/chevron-left'
import {ChevronRightIcon} from '@/features/files/assets/chevron-right'
import {usePathSegments} from '@/features/files/components/listing/actions-bar/path-bar/use-path-segments'
import {BASE_ROUTE_PATH, SEARCH_PATH} from '@/features/files/constants'
import {useIsTouchDevice} from '@/features/files/hooks/use-is-touch-device'
import {useNavigate as useFilesNavigate} from '@/features/files/hooks/use-navigate'
import {useIsFilesEmbedded} from '@/features/files/providers/files-capabilities-context'
import {setLastFilesPath} from '@/features/files/utils/last-files-path'
import {cn} from '@/lib/utils'
import {trpcReact} from '@/trpc/trpc'
import {focusRingClass, touchTargetClass} from '@/utils/element-classes'

/**
 * File browser navigation controls that track visited folder paths.
 * Maintains clean paths without query parameters to prevent
 * dialog re-renders during back/forward navigation.
 */
export function NavigationControls() {
	const {t} = useTranslation()
	const location = useLocation()
	const navigate = useNavigate()
	const {uiPath, navigateToDirectory} = useFilesNavigate()
	const isEmbedded = useIsFilesEmbedded()
	const isTouchDevice = useIsTouchDevice()
	const userId = trpcReact.user.get.useQuery().data?.userId
	// The folder above this one, when there is one to go up to
	const segments = usePathSegments()
	const parentPath = segments.length > 1 ? segments[segments.length - 2].path : undefined

	// Track visited paths and current position
	const [navigation, setNavigation] = useState({
		paths: [isEmbedded ? uiPath : location.pathname],
		currentPathIndex: 0,
	})

	// Add new path when location or embedded currentPath changes
	// and store the latest path in session storage for the Dock to restore
	useEffect(() => {
		// We only persist the path for the standalone Files feature (skip in embedded/Rewind)
		if (!isEmbedded) {
			const isSearchPage = location.pathname === `${BASE_ROUTE_PATH}${SEARCH_PATH}`
			const newPath = isSearchPage ? `${location.pathname}${location.search}` : location.pathname

			// Save the latest path to session storage so the Dock and Cmdk
			// can restore the last visited path when Files is reopened
			setLastFilesPath(userId, newPath)

			setNavigation((current) => {
				const lastPath = current.paths[current.currentPathIndex]

				// If the new path is the same as the last path, do nothing
				if (newPath === lastPath) {
					return current
				}

				// If the new path is a search page and the last path was also a search page,
				// update the last path with the new path so we don't store the path for every
				// search query character (e.g., "?q=t" => "?q=te" => "?q=tes" => "?q=test")
				if (isSearchPage && lastPath.startsWith(`${BASE_ROUTE_PATH}${SEARCH_PATH}`)) {
					const updatedPaths = [...current.paths.slice(0, current.currentPathIndex), newPath]
					return {
						paths: updatedPaths,
						currentPathIndex: current.currentPathIndex,
					}
				}

				// Normal navigation push, truncate any forward history
				const updatedPaths = [...current.paths.slice(0, current.currentPathIndex + 1), newPath]
				return {
					paths: updatedPaths,
					currentPathIndex: updatedPaths.length - 1,
				}
			})
		} else {
			const newPath = uiPath
			setNavigation((current) => {
				const lastPath = current.paths[current.currentPathIndex]
				if (newPath === lastPath) return current
				const updatedPaths = [...current.paths.slice(0, current.currentPathIndex + 1), newPath]
				return {
					paths: updatedPaths,
					currentPathIndex: updatedPaths.length - 1,
				}
			})
		}
	}, [isEmbedded, location.pathname, location.search, uiPath, userId])

	// Navigation handlers
	const handleBack = () => {
		if (!canGoBack) return
		const prevIndex = navigation.currentPathIndex - 1
		setNavigation((curr) => ({...curr, currentPathIndex: prevIndex}))
		if (isEmbedded) {
			navigateToDirectory(navigation.paths[prevIndex])
		} else {
			navigate(navigation.paths[prevIndex])
		}
	}

	const handleForward = () => {
		if (!canGoForward) return
		const nextIndex = navigation.currentPathIndex + 1
		setNavigation((curr) => ({...curr, currentPathIndex: nextIndex}))
		if (isEmbedded) {
			navigateToDirectory(navigation.paths[nextIndex])
		} else {
			navigate(navigation.paths[nextIndex])
		}
	}

	// can go back if there is a previous path
	const canGoBack = Boolean(navigation.paths[navigation.currentPathIndex - 1])
	// can go forward if there is a next path
	const canGoForward = Boolean(navigation.paths[navigation.currentPathIndex + 1])

	// A finger has no history to walk: on a touch screen the one control goes
	// up to the folder that holds this one, as far as the root of wherever Files
	// is. It is there however the folder was reached (a link from Recents, a
	// favorite, a reload), which a Back that only retraces steps never was.
	if (isTouchDevice && !isEmbedded) {
		if (!parentPath) return null
		return (
			<motion.button
				onClick={() => navigateToDirectory(parentPath)}
				// Level with the folder's name, which it stands before, not with the
				// middle of the name and the line under it
				className={cn(touchTargetClass, '-ml-1 shrink-0 -translate-y-[7px] rounded-full p-0.5', focusRingClass)}
				whileTap={{scale: 0.85}}
				aria-label={t('files-path.up')}
			>
				<ChevronLeftIcon className='size-6' />
			</motion.button>
		)
	}

	return (
		// Level with the path, which they stand before, not with the middle of
		// the path and the line under it
		<div className='flex shrink-0 -translate-y-[7px] items-center gap-1.5'>
			<motion.button
				onClick={handleBack}
				disabled={!canGoBack}
				className={cn('rounded-full p-0.5 transition-opacity hover:bg-white/8', focusRingClass, {
					'opacity-35 hover:bg-transparent': !canGoBack,
				})}
				whileTap={{scale: 0.85}}
				aria-label={t('back')}
			>
				<ChevronLeftIcon className='size-5' />
			</motion.button>
			<motion.button
				onClick={handleForward}
				disabled={!canGoForward}
				className={cn('rounded-full p-0.5 transition-opacity hover:bg-white/8', focusRingClass, {
					'opacity-35 hover:bg-transparent': !canGoForward,
				})}
				whileTap={{scale: 0.85}}
				aria-label={t('forward')}
			>
				<ChevronRightIcon className='size-5' />
			</motion.button>
		</div>
	)
}
