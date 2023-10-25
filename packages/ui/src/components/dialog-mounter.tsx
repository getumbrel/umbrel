import {ReactNode, useEffect, useState} from 'react'

/**
 * Fixes SSR issues with Radix Dialogs.
 * Based on:
 * https://github.com/radix-ui/primitives/issues/1386#issuecomment-1694710568
 * Fixes:
 * https://github.com/radix-ui/primitives/issues/1386
 */
export const DialogMounter = ({children}: {children: ReactNode}) => {
	const [isMounted, setIsMounted] = useState(false)

	useEffect(() => {
		setIsMounted(true)
	}, [])

	if (!isMounted) return null

	return children
}
