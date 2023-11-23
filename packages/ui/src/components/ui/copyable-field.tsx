import {useRef, useState} from 'react'
import {MdContentCopy} from 'react-icons/md'
import {useCopyToClipboard} from 'react-use'

import {Tooltip, TooltipContent, TooltipTrigger} from '@/shadcn-components/ui/tooltip'
import {sleep} from '@/utils/misc'

export function CopyableField({value}: {value: string}) {
	const ref = useRef<HTMLDivElement>(null)
	const [, copyToClipboard] = useCopyToClipboard()
	const [showCopied, setShowCopied] = useState(false)

	return (
		<div className='flex max-w-full items-center gap-2 overflow-hidden rounded-4 border border-dashed border-white/5 bg-white/4 text-14 leading-none text-white/40 outline-none focus-visible:border-white/40'>
			<code ref={ref} className='block flex-1 truncate px-2.5 py-1.5' onClick={() => selectText(ref.current)}>
				{value}
			</code>
			<Tooltip open={showCopied}>
				<TooltipTrigger asChild>
					<button
						className='rounded-4 p-1.5 ring-inset transition-colors hover:text-white/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40'
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
				<TooltipContent>Copied</TooltipContent>
			</Tooltip>
		</div>
	)
}

function selectText(el: HTMLElement | null) {
	if (!el) return
	const range = document.createRange()
	range.selectNodeContents(el)
	const sel = window.getSelection()
	sel?.removeAllRanges()
	sel?.addRange(range)
}
