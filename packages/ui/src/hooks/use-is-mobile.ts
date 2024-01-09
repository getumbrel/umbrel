import {useBreakpoint} from '@/utils/tw'

// Made for the '/settings' page, but probably useful elsewhere.
export function useIsMobile() {
	const breakpoint = useBreakpoint()
	const isMobile = breakpoint === 'sm' || breakpoint === 'md'

	return isMobile
}
