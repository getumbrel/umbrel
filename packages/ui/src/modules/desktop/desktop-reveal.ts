import {useEffect} from 'react'
import {create} from 'zustand'

// The desktop is hidden under a window by the window's route. A window that is
// closing still holds that route while it animates out, so it says here that the
// desktop can already come back in underneath it.
const useDesktopRevealStore = create(() => ({revealing: false}))

export const useDesktopRevealing = () => useDesktopRevealStore((state) => state.revealing)

export function useRevealDesktop(revealing: boolean) {
	useEffect(() => {
		if (!revealing) return
		useDesktopRevealStore.setState({revealing: true})
		return () => useDesktopRevealStore.setState({revealing: false})
	}, [revealing])
}
