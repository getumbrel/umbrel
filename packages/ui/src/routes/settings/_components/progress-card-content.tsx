import {Progress} from '@/shadcn-components/ui/progress'
import {cn} from '@/shadcn-lib/utils'

import {cardSecondaryValueClass, cardTitleClass, cardValueClass, cardValueSubClass} from './shared'

export function ProgressStatCardContent({
	title,
	value,
	valueSub,
	secondaryValue,
	progress,
	afterChildren,
}: {
	title?: string
	value?: string
	valueSub?: string
	secondaryValue?: string
	progress: number
	afterChildren?: React.ReactNode
}) {
	return (
		<div className='flex flex-col gap-4'>
			<div className={cardTitleClass}>{title}</div>
			<div className='flex items-baseline justify-between gap-4 truncate text-17 leading-tight'>
				<div className='flex items-baseline gap-1 truncate'>
					<span className={cardValueClass}>{value}</span>{' '}
					<span className={cn(cardValueSubClass, 'hidden sm:block')}>{valueSub}</span>
				</div>
				<span className={cn(cardSecondaryValueClass, 'text-xs')}>{secondaryValue}</span>
			</div>
			<Progress value={progress * 100} size='thicker' variant='primary' />
			{afterChildren}
		</div>
	)
}
