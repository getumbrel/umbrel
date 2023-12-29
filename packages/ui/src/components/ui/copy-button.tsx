import {useState} from 'react'
import {TbCopy} from 'react-icons/tb'
import {useCopyToClipboard} from 'react-use'

import {Tooltip, TooltipContent, TooltipTrigger} from '@/shadcn-components/ui/tooltip'
import {sleep} from '@/utils/misc'

export function CopyButton({value}: {value: string}) {
	const [, copyToClipboard] = useCopyToClipboard()
	const [showCopied, setShowCopied] = useState(false)

	return (
		<Tooltip open={showCopied}>
			<TooltipTrigger asChild>
				<button
					className='rounded-4 opacity-20 ring-inset transition-opacity hover:opacity-40 focus:outline-none focus-visible:opacity-60'
					onClick={async () => {
						copyToClipboard(value)
						setShowCopied(true)
						await sleep(1000)
						setShowCopied(false)
					}}
				>
					<TbCopy className='shrink-0' />
				</button>
			</TooltipTrigger>
			{/* TODO: consider putting in portal to avoid inheriting parent's styling */}
			<TooltipContent>Copied</TooltipContent>
		</Tooltip>
	)
}
