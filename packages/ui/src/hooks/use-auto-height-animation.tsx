import {useAnimation, type LegacyAnimationControls} from 'motion/react'
import {useLayoutEffect, useRef} from 'react'

export function useAutoHeightAnimation(deps: any[]): [LegacyAnimationControls, React.RefObject<HTMLDivElement | null>] {
	const controls = useAnimation()
	const ref = useRef<HTMLDivElement>(null)
	const height = useRef<number | null>(null)

	useLayoutEffect(() => {
		if (!ref.current) return
		ref.current.style.height = 'auto'
		const newHeight = ref.current.offsetHeight

		//console.log( newHeight )
		if (height.current !== null) {
			controls.set({height: height.current})
			controls.start({height: newHeight, opacity: 1})
		}

		height.current = newHeight
	}, [ref, controls, ...deps])

	return [controls, ref]
}
