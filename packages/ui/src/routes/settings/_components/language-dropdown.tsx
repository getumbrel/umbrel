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
							// Wait for the dropdown to close before changing the language
							setTimeout(() => {
								setActiveCode(code)
								// Reload because I don't want to deal with the complexity of changing the language on the fly
								// Keeping the state in sync with the language would be a pain
								window.location.reload()
							}, 200)
						}}
					>
						{name}
					</DropdownMenuCheckboxItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
