import {formatItemName, splitFileName} from '@/features/files/utils/format-filesystem-name'
import {cn} from '@/shadcn-lib/utils'

interface TruncatedFilenameProps {
	filename: string
	className?: string
	view?: 'list' | 'icons'
}

export function TruncatedFilename({filename, className, view = 'list'}: TruncatedFilenameProps) {
	// In icons view, we know the parent's height/width, so we don't need to use dynamic truncation
	if (view === 'icons') {
		return (
			<span className={cn('block w-full text-center', className)} title={filename}>
				{formatItemName({name: filename, maxLength: 30})}
			</span>
		)
	}

	// Keep last 16 characters always visible in suffix
	const SUFFIX_LENGTH = 16

	// Split the same number of characters whether or not there is a file extension
	const {name: fileName, extension} = splitFileName(filename)
	const nameSuffixLength = extension ? Math.max(0, SUFFIX_LENGTH - extension.length) : SUFFIX_LENGTH
	const prefixText = fileName.slice(0, fileName.length - nameSuffixLength)
	const suffixText = fileName.slice(fileName.length - nameSuffixLength) + (extension || '')

	return (
		<span className={cn('flex', className)} title={filename}>
			<span className='min-w-0 overflow-hidden text-ellipsis whitespace-nowrap'>{prefixText}</span>
			<span className='flex-shrink-0 whitespace-nowrap'>{suffixText}</span>
		</span>
	)
}
