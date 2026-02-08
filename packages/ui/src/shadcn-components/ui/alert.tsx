import {cva, type VariantProps} from 'class-variance-authority'
import * as React from 'react'

import {cn} from '@/shadcn-lib/utils'

const alertVariants = cva(
	'relative w-full rounded-lg border border-neutral-200 p-4 [&>svg~*]:pl-7 [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-neutral-950 dark:border-neutral-800 dark:[&>svg]:text-neutral-50',
	{
		variants: {
			variant: {
				default: 'bg-white text-neutral-950 dark:bg-neutral-950 dark:text-neutral-50',
				destructive:
					'border-red-500/50 text-red-500 dark:border-red-500 [&>svg]:text-red-500 dark:border-red-900/50 dark:text-red-900 dark:dark:border-red-900 dark:[&>svg]:text-red-900',
			},
		},
		defaultVariants: {
			variant: 'default',
		},
	},
)

function Alert({
	className,
	ref,
	variant,
	...props
}: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants> & {ref?: React.Ref<HTMLDivElement>}) {
	return <div ref={ref} role='alert' className={cn(alertVariants({variant}), className)} {...props} />
}

function AlertTitle({
	className,
	ref,
	...props
}: React.HTMLAttributes<HTMLHeadingElement> & {ref?: React.Ref<HTMLParagraphElement>}) {
	return <h5 ref={ref} className={cn('mb-1 leading-none font-medium tracking-tight', className)} {...props} />
}

function AlertDescription({
	className,
	ref,
	...props
}: React.HTMLAttributes<HTMLParagraphElement> & {ref?: React.Ref<HTMLParagraphElement>}) {
	return <div ref={ref} className={cn('text-sm [&_p]:leading-relaxed', className)} {...props} />
}

export {Alert, AlertTitle, AlertDescription}
