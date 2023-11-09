import {useState} from 'react'
import {MdContentCopy} from 'react-icons/md'
import {useCopyToClipboard} from 'react-use'

import {Tooltip, TooltipContent, TooltipTrigger} from '@/shadcn-components/ui/tooltip'
import {sleep} from '@/utils/misc'

export function CopyableField({code}: {code: string}) {
	const [, copyToClipboard] = useCopyToClipboard()
	const [showCopied, setShowCopied] = useState(false)

	return (
		<div className='flex max-w-full items-center gap-2 overflow-hidden rounded-4 border border-dashed border-white/5 bg-white/4 px-2.5 py-1.5 text-14 leading-none text-white/40 outline-none focus-visible:border-white/40'>
			<code className='block truncate'>{code}</code>
			<Tooltip open={showCopied}>
				<TooltipTrigger asChild>
					<button
						className='transition-colors hover:text-white/50'
						onClick={async () => {
							copyToClipboard(code)
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
