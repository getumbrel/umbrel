import {Globe} from 'lucide-react'

import {ChevronDown} from '@/components/chevron-down'
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {IconButton} from '@/components/ui/icon-button'
import {useLanguage} from '@/hooks/use-language'
import {languages, SupportedLanguageCode} from '@/utils/language'

export function LanguageDropdown() {
	return (
		<DropdownMenu>
			<LanguageDropdownTrigger />
			<LanguageDropdownContent />
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

export function LanguageDropdownContent() {
	const [activeCode, setActiveCode] = useLanguage()

	return (
		<DropdownMenuContent align='end'>
			{languages.map(({code, name}) => (
				<DropdownMenuCheckboxItem key={code} checked={activeCode === code} onSelect={() => setActiveCode(code)}>
					{name}
				</DropdownMenuCheckboxItem>
			))}
		</DropdownMenuContent>
	)
}
