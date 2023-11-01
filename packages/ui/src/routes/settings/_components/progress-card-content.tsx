import {Progress} from '@/shadcn-components/ui/progress'

import {cardSecondaryValueClass, cardTitleClass, cardValueClass, cardValueSubClass} from './shared'

export function ProgressStatCardContent({
	title,
	value,
	valueSub,
	secondaryValue,
	progress,
}: {
	title?: string
	value?: string
	valueSub?: string
	secondaryValue?: string
	progress: number
}) {
	return (
		<div className='flex flex-col gap-4'>
			<div className={cardTitleClass}>{title}</div>
			<div className='flex items-end justify-between'>
				<div className='leading-inter-trimmed'>
					<span className={cardValueClass}>{value}</span> <span className={cardValueSubClass}>{valueSub}</span>
				</div>
				<span className={cardSecondaryValueClass}>{secondaryValue}</span>
			</div>
			<Progress value={progress * 100} size='thicker' />
		</div>
	)
}
