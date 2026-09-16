import {createContext, useContext, type ReactNode} from 'react'

import {useItemClick} from '@/features/files/hooks/use-item-click'
import {usePreferences} from '@/features/files/hooks/use-preferences'
import type {ViewPreferences} from '@/features/files/types'

type FileItemContextValue = {
	handleClick: ReturnType<typeof useItemClick>['handleClick']
	handleDoubleClick: ReturnType<typeof useItemClick>['handleDoubleClick']
	view: ViewPreferences['view'] | undefined
}

const FileItemContext = createContext<FileItemContextValue | null>(null)

/**
 * What every row needs but shouldn't set up for itself: click handling (which
 * pulls in the file operations and their mutations) and the view preference. A listing keeps a few dozen virtualised rows mounted and
 * cycles them on every scroll, so per-row copies of these hooks meant hundreds
 * of query and mutation observers and a refetch for each row that mounted.
 */
export function FileItemProvider({children}: {children: ReactNode}) {
	const {handleClick, handleDoubleClick} = useItemClick()
	const {preferences} = usePreferences()

	return <FileItemContext value={{handleClick, handleDoubleClick, view: preferences?.view}}>{children}</FileItemContext>
}

export function useFileItemContext() {
	const context = useContext(FileItemContext)
	if (!context) throw new Error('useFileItemContext must be used within FileItemProvider')
	return context
}
