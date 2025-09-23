import {Tooltip, TooltipContent, TooltipTrigger} from '@/features/files/components/rewind/tooltip'
import {formatFilesystemDate} from '@/features/files/utils/format-filesystem-date'
import {useLanguage} from '@/hooks/use-language'
import {cn} from '@/shadcn-lib/utils'
import {t} from '@/utils/i18n'

export function TimelineBar({
	backups,
	selectedId,
	onSelect,
}: {
	backups: {id: string; time: number}[]
	selectedId: string | null | string
	onSelect: (id: string) => void
}) {
	const [lang] = useLanguage()
	if (!backups || backups.length === 0) {
		return <div className='h-2 w-full rounded-full bg-white/5' />
	}
	const min = backups[0].time
	const max = backups[backups.length - 1].time
	const span = Math.max(1, max - min)

	const selected = selectedId ? backups.find((b) => b.id === selectedId) || null : null
	const selectedPct = selected ? ((selected.time - min) / span) * 100 : null

	return (
		<div className='relative w-full py-3'>
			<div className='relative h-2 w-full rounded-full bg-[#D9D9D9]/20'>
				{selectedPct !== null ? (
					<div className='absolute inset-y-0 -translate-x-1/2' style={{left: `${selectedPct}%`}}>
						<div className='h-full w-px bg-white/30' />
					</div>
				) : null}

				{backups.map((b) => {
					const pct = ((b.time - min) / span) * 100
					const isSel = selectedId === b.id
					return (
						<Tooltip key={b.id}>
							<TooltipTrigger asChild>
								<button
									style={{left: `${pct}%`}}
									onClick={() => onSelect(b.id)}
									className={cn(
										'absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full p-2 md:p-0',
										isSel ? 'z-10 hover:z-10 focus-visible:z-10' : 'hover:z-10 focus-visible:z-10',
									)}
									aria-label={new Date(b.time).toLocaleString()}
								>
									<span
										className={cn(
											'block rounded-full',
											isSel
												? 'size-2 bg-white shadow-[0_0_4px_2px_rgba(255,255,255,0.5)]'
												: 'size-2 bg-[#5B5B5B] hover:bg-[#6d6d6d]',
										)}
									/>
								</button>
							</TooltipTrigger>
							<TooltipContent side='bottom' className='text-[12px] text-black'>
								{b.id === 'current' ? t('rewind.now') : formatFilesystemDate(b.time, lang)}
							</TooltipContent>
						</Tooltip>
					)
				})}
			</div>
		</div>
	)
}
