import {type ReactNode} from 'react'

export function InstructionContainer({children}: {children: ReactNode}) {
	return <div className='divide-y divide-white/6 overflow-hidden rounded-12 bg-white/6'>{children}</div>
}
export function InstructionItem({children}: {children: ReactNode}) {
	return (
		<div className='flex items-center justify-between gap-3 p-3 text-12 font-medium -tracking-3'>
			<span>{children}</span>
		</div>
	)
}
