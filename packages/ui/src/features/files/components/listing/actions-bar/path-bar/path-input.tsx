import {useLayoutEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'

import {Input} from '@/components/ui/input'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {cn} from '@/lib/utils'

interface PathInputProps {
	path: string
	onClose: () => void
}

export function PathInput({path, onClose}: PathInputProps) {
	const {t} = useTranslation()
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
		// As tall as the title it stands in for, so nothing under it moves
		<div
			className='flex h-[1lh] items-center rounded-6 bg-white/8 px-1.5 text-17 leading-tight ring-1 ring-brand'
			role='group'
			aria-label={t('files-path.input-group')}
		>
			<Input
				ref={inputRef}
				value={inputValue}
				onChange={(e) => setInputValue(e.target.value)}
				onKeyDown={handleKeyDown}
				onBlur={onClose}
				className={cn(
					'h-full w-full bg-transparent text-13 text-white',
					'border-none p-0 [outline:none]',
					'focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0',
					'[&:active]:bg-transparent [&:focus]:bg-transparent [&:hover]:bg-transparent',
				)}
				spellCheck={false}
				aria-label={t('files-path.input-label')}
			/>
		</div>
	)
}
