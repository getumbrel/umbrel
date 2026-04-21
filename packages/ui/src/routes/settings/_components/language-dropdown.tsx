import {Globe} from 'lucide-react'
import {matchSorter} from 'match-sorter'
import {useEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'

import {ChevronDown} from '@/components/chevron-down'
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {IconButton} from '@/components/ui/icon-button'
import {Input} from '@/components/ui/input'
import {ScrollArea} from '@/components/ui/scroll-area'
import {useLanguage} from '@/hooks/use-language'
import {languages, SupportedLanguageCode} from '@/utils/language'

export function LanguageDropdown() {
	const [open, setOpen] = useState(false)
	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<LanguageDropdownTrigger />
			<LanguageDropdownContent open={open} onOpenChange={setOpen} />
		</DropdownMenu>
	)
}

export function LanguageDropdownTrigger() {
	const [activeCode] = useLanguage()

	return (
		<DropdownMenuTrigger asChild>
			<IconButton icon={Globe}>
				{languages.find(({code}) => code === activeCode)?.name}
				<ChevronDown />
			</IconButton>
		</DropdownMenuTrigger>
	)
}

export function LanguageDropdownContent({open, onOpenChange}: {open: boolean; onOpenChange: (o: boolean) => void}) {
	const {t} = useTranslation()
	const [activeCode, setActiveCode] = useLanguage()
	const [query, setQuery] = useState('')
	const inputRef = useRef<HTMLInputElement>(null)

	useEffect(() => {
		if (!open) {
			setQuery('')
			return
		}
		setTimeout(() => {
			inputRef.current?.focus()
			inputRef.current?.select()
		}, 0)
	}, [open])

	const results = query
		? matchSorter([...languages], query, {
				keys: ['name', 'code', 'englishName'],
				threshold: matchSorter.rankings.WORD_STARTS_WITH,
			})
		: [...languages]

	return (
		<DropdownMenuContent className='flex max-h-80 flex-col gap-3' align='end'>
			<Input
				value={query}
				className='shrink-0'
				onChange={(e) => setQuery(e.target.value)}
				onKeyDown={(e) => {
					e.stopPropagation()
					if (e.key === 'Enter') {
						e.preventDefault()
						if (results.length > 0) {
							setActiveCode(results[0].code as SupportedLanguageCode)
							setQuery('')
							onOpenChange(false)
						}
					}
					if (e.key === 'Escape') {
						setQuery('')
						onOpenChange(false)
					}
				}}
				sizeVariant='short-square'
				placeholder={t('language.search')}
				ref={inputRef}
			/>
			{results.length === 0 && <div className='px-1 pb-1 text-13 text-white/40'>{t('no-results-found')}</div>}
			{results.length > 0 && (
				<ScrollArea className='relative -mx-2.5 flex h-full flex-col px-2.5'>
					{results.map((lang, i) => (
						<DropdownMenuCheckboxItem
							key={lang.code}
							checked={activeCode === lang.code}
							onSelect={() => setActiveCode(lang.code as SupportedLanguageCode)}
							className='flex gap-2.5'
							data-highlighted={i === 0 && query ? true : undefined}
						>
							<LanguageGlyph glyph={lang.glyph} />
							{lang.name}
						</DropdownMenuCheckboxItem>
					))}
				</ScrollArea>
			)}
		</DropdownMenuContent>
	)
}

function LanguageGlyph({glyph}: {glyph: string}) {
	return (
		<div className='flex h-6 w-6 shrink-0 items-center justify-center rounded-5 bg-white/10 text-12 leading-none font-semibold'>
			{glyph}
		</div>
	)
}
