import {cn} from '@/shadcn-lib/utils'

export function Card({children, className}: {children?: React.ReactNode; className?: string}) {
	return <div className={cn('rounded-12 bg-white/5 p-6', className)}>{children}</div>
}
