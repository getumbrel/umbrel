import {useState} from 'react'
import {MdContentCopy} from 'react-icons/md'
import {useCopyToClipboard} from 'react-use'

import {Tooltip, TooltipContent, TooltipTrigger} from '@/shadcn-components/ui/tooltip'
import {cn} from '@/shadcn-lib/utils'
import {t} from '@/utils/i18n'
import {sleep} from '@/utils/misc'

export function InlineCopyableField({value, className}: {value: string; className?: string}) {
	const [, copyToClipboard] = useCopyToClipboard()
	const [showCopied, setShowCopied] = useState(false)

	return (
		<span
			className={cn(
				'inline-flex items-center gap-1 rounded border border-dashed border-white/5 bg-white/10 px-1.5',
				className,
			)}
		>
			<span className='truncate'>{value}&nbsp;</span>

			<Tooltip open={showCopied}>
				<TooltipTrigger asChild>
					<button
						className='inline-flex items-center opacity-40 transition-opacity hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40'
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
				<TooltipContent>{t('clipboard.copied')}</TooltipContent>
			</Tooltip>
		</span>
	)
}
