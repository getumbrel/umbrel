import {cn} from '@/shadcn-lib/utils'

/**
 * Put a darken layer over the page
 */
export function DarkenLayer({className}: {className?: string}) {
	return <div className={cn('fixed inset-0 bg-black/50 contrast-more:bg-black', className)} />
}
