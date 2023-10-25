import {useState} from 'react'

import {SegmentedControl} from '@/components/ui/segmented-control'
import {Progress} from '@/shadcn-components/ui/progress'
import {cn} from '@/shadcn-lib/utils'
import {tw} from '@/utils/tw'

export function CardProgressStat({
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

export function CardTempStat() {
	const [activeTab, setActiveTab] = useState(tabs[0].id)

	return (
		<div className='flex flex-col gap-4'>
			<div className={cardTitleClass}>Tempurature</div>
			<div className='flex items-center justify-between'>
				<div className='flex flex-col gap-2.5'>
					<div className={cardValueClass}>45°C</div>
					<div className='flex items-center gap-2'>
						<div className='h-[5px] w-[5px] animate-pulse rounded-full bg-success ring-3 ring-success/20'></div>
						<div className={cn(cardSecondaryValueClass, 'leading-inter-trimmed')}>Optimal</div>
					</div>
				</div>
				<SegmentedControl variant='primary' tabs={tabs} value={activeTab} onValueChange={setActiveTab} />
			</div>
		</div>
	)
}

const tabs = [
	{id: 'c', label: '°C'},
	{id: 'f', label: '°F'},
]

const cardTitleClass = tw`text-12 font-semibold leading-none -tracking-2 text-white/40`
const cardValueClass = tw`text-17 font-bold leading-inter-trimmed -tracking-4`
const cardValueSubClass = tw`text-14 font-bold leading-inter-trimmed -tracking-3 text-white/40`
const cardSecondaryValueClass = tw`text-14 font-medium leading-inter-trimmed -tracking-3 text-white/40`
