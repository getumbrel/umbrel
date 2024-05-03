import {H2, H3} from '@stories/components'
import {JSONTree} from 'react-json-tree'
import {useWindowSize} from 'react-use'
import {Config} from 'tailwindcss'
import resolveConfig from 'tailwindcss/resolveConfig'

import {screens, useBreakpoint} from '@/utils/tw'

import tailwindConfig from '../../../../tailwind.config.ts'

export const tailwindConfigFull = resolveConfig({
	...tailwindConfig,
	plugins: [],
} as Config)

export default function TailwindStory() {
	const breakpoint = useBreakpoint()
	const {width} = useWindowSize()

	return (
		<div>
			<div className='bg-red-500/50'>
				<div className='text-2xl leading-inter-trimmed'>leading-inter-trimmed</div>
			</div>
			<H2>
				BREAKPOINT: <b>{breakpoint}</b>, WIDTH: <b>{width}</b>
			</H2>
			<div className='flex gap-2'>
				<span className='text-white/50 sm:text-white'>sm:</span>
				<span className='text-white/50 md:text-white'>md:</span>
				<span className='text-white/50 lg:text-white'>lg:</span>
				<span className='text-white/50 xl:text-white'>xl:</span>
				<span className='text-white/50 2xl:text-white'>2xl:</span>
			</div>
			<div className='flex flex-wrap gap-2'>
				<span className='text-white/50 max-sm:text-white'>max-sm:</span>
				<span className='text-white/50 max-md:text-white'>max-md:</span>
				<span className='text-white/50 max-lg:text-white'>max-lg:</span>
				<span className='text-white/50 max-xl:text-white'>max-xl:</span>
				<span className='text-white/50 max-2xl:text-white'>max-2xl:</span>
			</div>
			<H3>screens</H3>
			<JSONTree data={screens} />
			<H3>tailwind full config</H3>
			<JSONTree data={tailwindConfigFull} />
		</div>
	)
}
