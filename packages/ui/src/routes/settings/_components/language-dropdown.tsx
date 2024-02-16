import {TbLanguage} from 'react-icons/tb'

import {ChevronDown} from '@/assets/chevron-down'
import {IconButton} from '@/components/ui/icon-button'
import {languages, useLanguage} from '@/hooks/use-language'
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from '@/shadcn-components/ui/dropdown-menu'

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
			<IconButton icon={TbLanguage}>
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
