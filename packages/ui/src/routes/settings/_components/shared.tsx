import {Progress} from '@/shadcn-components/ui/progress'
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

export const cardTitleClass = tw`text-12 font-semibold leading-none -tracking-2 text-white/40`
export const cardValueClass = tw`text-17 font-bold leading-inter-trimmed -tracking-4`
export const cardValueSubClass = tw`text-14 font-bold leading-inter-trimmed -tracking-3 text-white/40`
export const cardSecondaryValueClass = tw`text-14 font-medium leading-inter-trimmed -tracking-3 text-white/40`
