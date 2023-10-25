import {clsx, type ClassValue} from 'clsx'
import {extendTailwindMerge} from 'tailwind-merge'

const num = (classPart: string) => /^\d+$/.test(classPart)

const customTwMerge = extendTailwindMerge({
	classGroups: {
		// Without this, styles like text-12 don't work properly with other text-* styles
		'font-size': [{text: ['base', num]}],
		'border-width': [{border: ['hpx']}],
	},
})

export function cn(...inputs: ClassValue[]) {
	return customTwMerge(clsx(inputs))
}
