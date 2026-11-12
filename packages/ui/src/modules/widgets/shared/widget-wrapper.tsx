import {ReactNode} from 'react'

import {cn} from '@/lib/utils'

// The homescreen row decides whether its widgets are named (`--widget-names`)
// and how tall a slot is with or without the name (`--widget-labeled-h`); see
// widget-row.tsx
export function WidgetWrapper({label, children}: {label: string; children?: ReactNode}) {
	return (
		<div
			className={cn(
				'flex w-[var(--widget-w)] flex-col items-center justify-between',
				label && 'h-[var(--widget-labeled-h)]',
			)}
		>
			{children}
			{label && (
				<div
					// Keeps its size like an app's name, whatever the text size setting
					className='desktop relative z-0 max-w-full truncate text-center text-13 leading-normal drop-shadow-desktop-label [--text-boost:0px] contrast-more:rounded-4 contrast-more:bg-black contrast-more:px-1'
					style={{display: 'var(--widget-names, block)'}}
				>
					{label}
				</div>
			)}
		</div>
	)
}
