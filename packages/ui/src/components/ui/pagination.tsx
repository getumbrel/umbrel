import {ChevronLeft, ChevronRight, MoreHorizontal} from 'lucide-react'
import * as React from 'react'

import {ButtonProps, buttonVariants} from '@/components/ui/button'
import {cn} from '@/lib/utils'

const Pagination = ({className, ...props}: React.ComponentProps<'nav'>) => (
	<nav
		role='navigation'
		aria-label='pagination'
		className={cn('mx-auto flex w-full justify-center', className)}
		{...props}
	/>
)

function PaginationContent({
	className,
	ref,
	...props
}: React.ComponentProps<'ul'> & {ref?: React.Ref<HTMLUListElement>}) {
	return <ul ref={ref} className={cn('flex flex-row items-center gap-1', className)} {...props} />
}

function PaginationItem({className, ref, ...props}: React.ComponentProps<'li'> & {ref?: React.Ref<HTMLLIElement>}) {
	return <li ref={ref} className={cn('flex h-7 w-7 items-center justify-center', className)} {...props} />
}

type PaginationLinkProps = {
	isActive?: boolean
} & Pick<ButtonProps, 'size'> &
	React.ComponentProps<'a'>

const PaginationLink = ({className, isActive, size = 'icon-only', ...props}: PaginationLinkProps) => (
	<a
		aria-current={isActive ? 'page' : undefined}
		className={cn(
			buttonVariants({
				variant: isActive ? 'primary' : 'default',
				size,
			}),
			'rounded-md',
			'h-7 w-7',
			className,
		)}
		{...props}
	/>
)

const PaginationPrevious = ({
	className,
	children,
	...props
}: React.ComponentProps<typeof PaginationLink> & {children?: React.ReactNode}) => (
	<PaginationLink aria-label='Go to previous page' size='default' className={cn('h-7 w-7', className)} {...props}>
		{children || (
			<>
				<ChevronLeft className='h-4 w-4' />
				<span>Previous</span>
			</>
		)}
	</PaginationLink>
)

const PaginationNext = ({
	className,
	children,
	...props
}: React.ComponentProps<typeof PaginationLink> & {children?: React.ReactNode}) => (
	<PaginationLink aria-label='Go to next page' size='default' className={cn('gap-1 pr-2.5', className)} {...props}>
		{children || (
			<>
				<span>Next</span>
				<ChevronRight className='h-4 w-4' />
			</>
		)}
	</PaginationLink>
)

const PaginationEllipsis = ({className, ...props}: React.ComponentProps<'span'>) => (
	<span aria-hidden className={cn('flex h-9 w-9 items-center justify-center', className)} {...props}>
		<MoreHorizontal className='h-4 w-4' />
		<span className='sr-only'>More pages</span>
	</span>
)

export {
	Pagination,
	PaginationContent,
	PaginationLink,
	PaginationItem,
	PaginationPrevious,
	PaginationNext,
	PaginationEllipsis,
}
