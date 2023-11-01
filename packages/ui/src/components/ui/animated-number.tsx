import {animate} from 'framer-motion'
import {useEffect, useRef} from 'react'
import {usePrevious} from 'react-use'

type CounterProps = {
	to: number
}

export function AnimatedNumber({to}: CounterProps) {
	const nodeRef = useRef<HTMLSpanElement>(null)
	const from = usePrevious(to) ?? to

	useEffect(() => {
		const node = nodeRef.current

		if (!node) {
			return
		}

		if (to === Infinity || to === -Infinity || isNaN(to)) {
			node.textContent = to.toString()
			return
		}

		const controls = animate(from, to, {
			duration: 0.2,
			ease: 'circOut',
			onUpdate(value) {
				node.textContent = value.toFixed(0)
			},
		})

		return () => controls.stop()
	}, [from, to])

	return <span className='tabular-nums' ref={nodeRef} />
}
