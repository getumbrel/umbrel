import {useState} from 'react'

import {BareCoverMessage, CoverMessage, CoverMessageParagraph} from '@/components/ui/cover-message'
import {Button} from '@/shadcn-components/ui/button'

const covers = ['none', 'bare', 'default']

type Cover = (typeof covers)[number]

export default function Cover() {
	const [cover, setCover] = useState<Cover>('none')

	return (
		<div>
			{covers.map((cover) => (
				<Button size='lg' key={cover} onClick={() => setCover(cover)}>
					{cover}
				</Button>
			))}
			{cover === 'none' && <div>No cover</div>}
			{cover === 'bare' && (
				<BareCoverMessage onClick={() => setCover('none')}>
					<CoverMessageParagraph>Bare</CoverMessageParagraph>
				</BareCoverMessage>
			)}
			{cover === 'default' && (
				<CoverMessage onClick={() => setCover('none')} bodyClassName='delay-300'>
					<CoverMessageParagraph>Default</CoverMessageParagraph>
				</CoverMessage>
			)}
		</div>
	)
}
