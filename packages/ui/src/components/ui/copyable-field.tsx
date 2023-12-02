import {useRef, useState} from 'react'
import {MdContentCopy} from 'react-icons/md'
import {useCopyToClipboard} from 'react-use'
import {useIsFocused} from 'use-is-focused'

import {Tooltip, TooltipContent, TooltipTrigger} from '@/shadcn-components/ui/tooltip'
import {cn} from '@/shadcn-lib/utils'
import {sleep} from '@/utils/misc'

export function CopyableField({
	value,
	className,
	isPassword,
	narrow,
}: {
	value: string
	className?: string
	isPassword?: boolean
	narrow?: boolean
}) {
	const ref = useRef<HTMLInputElement>(null)
	const [, copyToClipboard] = useCopyToClipboard()
	const [showCopied, setShowCopied] = useState(false)

	const focused = useIsFocused(ref)

	return (
		<div
			className={cn(
				// 'items-stretch' to make sure button is the same height as the field
				'flex max-w-full items-stretch overflow-hidden rounded-4 border border-dashed border-white/5 bg-white/4 text-14 leading-none text-white/40 outline-none focus-visible:border-white/40',
				className,
			)}
		>
			<input
				readOnly
				ref={ref}
				onClick={() => setTimeout(() => ref.current?.select())}
				className={cn(
					'block flex-1 appearance-none truncate bg-transparent py-1.5 pl-2.5 font-mono outline-none',
					narrow && 'py-0.5',
				)}
				type={isPassword && !focused ? 'password' : 'text'}
				value={value}
			/>

			<Tooltip open={showCopied}>
				<TooltipTrigger asChild>
					<button
						className='rounded-4 px-1.5 ring-inset transition-colors hover:text-white/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40'
						onClick={async () => {
							copyToClipboard(value)
							setShowCopied(true)
							await sleep(1000)
							setShowCopied(false)
						}}
					>
						<MdContentCopy className='shrink-0' />
					</button>
				</TooltipTrigger>
				{/* TODO: consider putting in portal to avoid inheriting parent's styling */}
				<TooltipContent>Copied</TooltipContent>
			</Tooltip>
		</div>
	)
}
