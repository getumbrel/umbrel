import {Globe} from 'lucide-react'
import {useState} from 'react'

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
	const [temporaryCode, setTemporaryCode] = useState(activeCode)

	const changeLanguage = async (code: SupportedLanguageCode) => {
		setTemporaryCode(code)
		// Delay so user can see the checkmark
		setTimeout(() => setActiveCode(code), 200)
	}

	return (
		<DropdownMenuContent align='end'>
			{languages.map(({code, name}) => (
				<DropdownMenuCheckboxItem
					key={code}
					checked={temporaryCode === code}
					onSelect={() => changeLanguage(code)}
					disabled={temporaryCode !== activeCode}
				>
					{name}
				</DropdownMenuCheckboxItem>
			))}
		</DropdownMenuContent>
	)
}
