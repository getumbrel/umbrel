import {useEffect, useRef} from 'react'

import {buttonVariants} from '@/shadcn-components/ui/button'
import {cn} from '@/shadcn-lib/utils'

export function InstallButton({
	installSize,
	progress,
	state,
	onInstallClick,
	onOpenClick,
}: {
	installSize: string
	progress: number
	state: 'initial' | 'installing' | 'installed'
	onInstallClick: () => void
	onOpenClick: () => void
}) {
	const ref = useRef<HTMLButtonElement>(null)

	useEffect(() => {
		if (!ref.current) return

		switch (state) {
			case 'initial': {
				const width = ref.current?.offsetWidth
				ref.current.style.width = width + 'px'
				break
			}
			case 'installing': {
				ref.current.style.width = '135px'
				break
			}
			case 'installed': {
				// Size of "Open" state
				ref.current.style.width = '68px'
				break
			}
		}
	}, [state, progress])

	return (
		<button
			ref={ref}
			className={cn(
				buttonVariants({size: 'lg', variant: 'primary'}),
				'shadow-button-highlight select-none text-15 font-semibold -tracking-3 disabled:bg-brand/60 disabled:opacity-100',
			)}
			style={{
				// Adding transitions so hover and other transitions work
				transition: 'opacity 0.2s, width 0.2s, background-color 0.2s',
				// TODO: fix hover not working when done installing
				backgroundImage: `linear-gradient(to right, hsl(var(--color-brand)) ${progress}%, transparent ${progress}%)`,
			}}
			onClick={() => {
				if (state === 'initial') {
					onInstallClick()
				} else if (state === 'installed') {
					onOpenClick()
				}
			}}
			disabled={state === 'installing'}
		>
			{state === 'initial' && (
				<>
					Install <span className='whitespace-nowrap -tracking-normal opacity-40'>{installSize}</span>
				</>
			)}
			{state === 'installing' && (
				<>
					{/* 4ch to fit "100%", tabular-nums so each char is the same width */}
					Installing <span className='w-[4ch] text-right tabular-nums -tracking-[0.08em] opacity-40'>{progress}%</span>
				</>
			)}
			{state === 'installed' && 'Open'}
		</button>
	)
}
