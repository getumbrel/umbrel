import {ReactNode} from 'react'

export function WidgetButtonLink({href, children}: {href: string; children: ReactNode}) {
	return (
		<a
			href={href}
			className='flex h-[24px] cursor-pointer select-none items-center justify-center rounded-5 bg-white/5 px-2.5 text-12 font-medium transition-colors hover:bg-white/10 active:bg-white/5 md:h-[30px] md:rounded-full'
		>
			{children}
		</a>
	)
}
