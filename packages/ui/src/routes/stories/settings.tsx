import {range} from 'remeda'

import {Card} from '@/components/ui/card'
import {Separator} from '@/shadcn-components/ui/separator'

import {TempStatCardContent} from '../settings/_components/temp-stat-card-content'

export function SettingsStory() {
	return (
		<div className='flex flex-col flex-wrap items-start gap-8 bg-white/10 p-8'>
			<Card>
				<TempStatCardContent />
			</Card>
			<Card>
				<TempStatCardContent tempInCelcius={NaN} defaultUnit='c' />
			</Card>
			<Card>
				<TempStatCardContent tempInCelcius={Infinity} defaultUnit='c' />
			</Card>
			<Separator />
			<div className='flex flex-row flex-wrap gap-2'>
				{range(-3, 11).map((temp) => (
					<Card key={temp}>
						<TempStatCardContent tempInCelcius={temp * 10} defaultUnit='c' />
					</Card>
				))}
			</div>
		</div>
	)
}
