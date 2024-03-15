import {IS_DEV} from '@/utils/misc'

export function DebugOnly({children}: {children: React.ReactNode}) {
	if (IS_DEV) {
		return (
			<div className='relative border border-dotted border-white/50 p-2'>
				{children}
				<div className='absolute left-0 top-0 select-none bg-destructive2 px-0.5 text-[8px]'>development only</div>
			</div>
		)
	}
	return null
}

export function DebugOnlyBare({children}: {children: React.ReactNode}) {
	if (IS_DEV) {
		return <>{children}</>
	}
	return null
}
