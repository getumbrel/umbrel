import {clsx, type ClassValue} from 'clsx'
import {extendTailwindMerge} from 'tailwind-merge'

const num = (classPart: string) => /^\d+$/.test(classPart)

const customTwMerge = extendTailwindMerge({
	extend: {
		classGroups: {
			// Without this, styles like text-12 don't work properly with other text-* styles
			'font-size': [{text: ['base', num]}],
			// Allows cn('rounded-12', 'rounded-20') to cause the 20 to override the 12
			rounded: [{rounded: ['base', num]}],
			'border-w': [{border: ['hpx', 'px']}],
		},
	},
})

export function cn(...inputs: ClassValue[]) {
	return customTwMerge(clsx(inputs))
}
