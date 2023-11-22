import {cva} from 'class-variance-authority'

import {tw} from '@/utils/tw'

export const widgetContainerCva = cva(
	tw`bg-neutral-800/60 rounded-20 p-5 w-[var(--widget-w)] h-[var(--widget-h)] shrink-0 flex flex-col gap-2 cursor-default`,
	// ^-- Using `tw` to force vscode to recognize the tailwind classes
	{
		variants: {
			variant: {
				'with-backdrop-blur':
					'bg-neutral-900/80 backdrop-blur-3xl contrast-more:backdrop-blur-none contrast-more:bg-neutral-900 backdrop-saturate-[300%] shadow-widget',
				default: '',
			},
		},
		defaultVariants: {
			variant: 'with-backdrop-blur',
		},
	},
)

export const widgetTextCva = cva('text-13 leading-snug font-semibold -tracking-2 truncate', {
	variants: {
		opacity: {
			primary: 'opacity-80',
			secondary: 'opacity-50',
			tertiary: 'opacity-25',
		},
	},
})
