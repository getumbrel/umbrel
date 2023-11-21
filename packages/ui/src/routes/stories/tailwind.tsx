import {JSONTree} from 'react-json-tree'

import {H2, H3} from '@/layouts/stories'
import {screens, tailwindConfigFull, useBreakpoint} from '@/utils/tw'

export default function TailwindStory() {
	const breakpoint = useBreakpoint()

	return (
		<div>
			<H2>
				BREAKPOINT: <b>{breakpoint}</b>
			</H2>
			<H3>screens</H3>
			<JSONTree data={screens} />
			<H3>tailwind full config</H3>
			<JSONTree data={tailwindConfigFull} />
		</div>
	)
}
