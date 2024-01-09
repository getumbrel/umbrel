import {Globe} from 'lucide-react'

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
	const [activeCode, setActiveCode] = useLanguage()

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
						}}
					>
						{name}
					</DropdownMenuCheckboxItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
