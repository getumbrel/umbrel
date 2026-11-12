import {Progress} from '@/components/ui/progress'
import {cn} from '@/lib/utils'

export function ProgressStatCardContent({
	title,
	value,
	valueSub,
	progress,
	afterChildren,
	headerIcon,
}: {
	title: string
	value?: string
	valueSub?: string
	progress: number
	afterChildren?: React.ReactNode
	headerIcon?: React.ReactNode
}) {
	const compactValue = (className?: string) => (
		// The total moves under the used amount before either is cut
		<span className={cn('flex min-w-0 flex-wrap items-baseline gap-x-1 font-medium text-white', className)}>
			<span className='truncate'>{value}</span>
			<span className='truncate text-white/45'>{valueSub}</span>
		</span>
	)

	return (
		<div className={cn('flex flex-col', headerIcon ? 'gap-3' : 'gap-4')}>
			{headerIcon ? (
				<>
					<div className='flex min-w-0 items-start justify-between gap-3 text-13 -tracking-2'>
						<span className='min-w-0 truncate font-semibold text-white/45'>{title}</span>
						{headerIcon}
					</div>
					<div className='flex min-w-0 justify-start text-13 -tracking-2'>{compactValue()}</div>
				</>
			) : (
				// A value that doesn't fit beside its title moves under it
				<div className='flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 text-13 -tracking-2'>
					<span className='font-semibold text-white/45'>{title}</span>
					{compactValue('ml-auto max-w-full')}
				</div>
			)}
			<Progress value={progress * 100} size='thicker' variant='primary' trackClassName='bg-white/10' />
			{afterChildren}
		</div>
	)
}
