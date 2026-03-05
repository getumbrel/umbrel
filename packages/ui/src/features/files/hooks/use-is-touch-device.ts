import {useMedia} from 'react-use'

export function useIsTouchDevice() {
	const isHoverNone = useMedia('(hover: none)')
	return isHoverNone
}
