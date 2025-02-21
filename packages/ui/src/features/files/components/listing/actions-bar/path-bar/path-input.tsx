import {useLayoutEffect, useRef, useState} from 'react'

import {useNavigate} from '@/features/files/hooks/use-navigate'
import {Input} from '@/shadcn-components/ui/input'
import {cn} from '@/shadcn-lib/utils'
import {t} from '@/utils/i18n'

interface PathInputProps {
	path: string
	onClose: () => void
}

export function PathInput({path, onClose}: PathInputProps) {
	const inputRef = useRef<HTMLInputElement>(null)
	const {navigateToDirectory} = useNavigate()
	const [inputValue, setInputValue] = useState(path)

	useLayoutEffect(() => {
		// We use a 50ms delay to focus the path input after context menu animations
		// Without this, the input would not focus and immediately close on smaller screen widths
		const timeoutId = setTimeout(() => {
			inputRef.current?.focus()
		}, 50)
		return () => clearTimeout(timeoutId)
	}, [])

	const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === 'Enter') {
			e.preventDefault()
			navigateToDirectory(inputValue)
			onClose()
		}
		if (e.key === 'Escape') {
			onClose()
		}
	}

	return (
		<div
			className={cn(
				'border-[0.5px] bg-white/6',
				'flex h-8 items-center rounded-full border-[hsl(var(--color-brand))] p-3 py-1',
			)}
			role='group'
			aria-label={t('files-path.input-group')}
		>
			<div className='flex flex-1 items-center'>
				<Input
					ref={inputRef}
					value={inputValue}
					onChange={(e) => setInputValue(e.target.value)}
					onKeyDown={handleKeyDown}
					onBlur={onClose}
					className={cn(
						'h-8 bg-transparent text-xs text-white',
						'p-0 [border:none] [outline:none]',
						'focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0',
						'[&:active]:bg-transparent [&:focus]:bg-transparent [&:hover]:bg-transparent',
						'w-full',
					)}
					spellCheck={false}
					aria-label={t('files-path.input-label')}
				/>
			</div>
		</div>
	)
}
