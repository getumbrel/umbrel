import {H2} from '@stories/components'
import {useRef} from 'react'
import {JSONTree} from 'react-json-tree'

import {AppIcon} from '@/components/app-icon'
import {useColorThief} from '@/hooks/use-color-thief'

export default function ColorThiefExample() {
	const title = 'Color Thief'
	// const [colors, setColors] = useState<[][] | undefined>()
	const ref = useRef<HTMLImageElement>(null)
	const colors = useColorThief(ref)

	return (
		<div>
			<H2>{title}</H2>
			{/* <img
				src={'https://getumbrel.github.io/umbrel-apps-gallery/bitfeed/icon.svg'}
				className='h-10 w-10'
				crossOrigin='anonymous'
				ref={ref}
			/> */}
			<AppIcon
				src={'https://getumbrel.github.io/umbrel-apps-gallery/bitfeed/icon.svg'}
				crossOrigin='anonymous'
				size={128}
				ref={ref}
			/>
			<div
				className='h-10 w-10 bg-white'
				style={{
					background: colors && `linear-gradient(123deg, ${colors[0]}, ${colors[1]})`,
				}}
			></div>
			<JSONTree data={colors} />
		</div>
	)
}
