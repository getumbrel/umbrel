import {Globe} from 'lucide-react'
import {useTranslation} from 'react-i18next'
import {useLocalStorage} from 'react-use'

import {ChevronDown} from '@/assets/chevron-down'
import {IconButton} from '@/components/ui/icon-button'
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from '@/shadcn-components/ui/dropdown-menu'

export function LanguageDropdown() {
	const {i18n} = useTranslation()
	const [activeCode, setActiveCode] = useLocalStorage('i18nextLng', 'en', {
		raw: true,
	})

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<IconButton icon={Globe} id='language'>
					{languages.find(({code}) => code === activeCode)?.name}
					<ChevronDown />
				</IconButton>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='end'>
				{languages.map(({code, name}) => (
					<DropdownMenuCheckboxItem
						key={code}
						checked={activeCode === code}
						onSelect={() => {
							setActiveCode(code)
							i18n.changeLanguage(code)
						}}
					>
						{name}
					</DropdownMenuCheckboxItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

export const languages = [
	{name: 'English', code: 'en'},
	{name: 'Français', code: 'fr'},
	{name: 'العربية', code: 'ar'},
]
