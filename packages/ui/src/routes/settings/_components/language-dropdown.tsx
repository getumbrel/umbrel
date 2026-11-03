import {type ReactNode} from 'react'
import {useTranslation} from 'react-i18next'

import {ChevronDown} from '@/components/chevron-down'
import {Button} from '@/components/ui/button'
import {SearchablePicker} from '@/components/ui/searchable-picker'
import {useLanguage} from '@/hooks/use-language'
import {languages, SupportedLanguageCode} from '@/utils/language'

export function LanguageDropdown({
	children,
	open,
	onOpenChange,
}: {
	children?: ReactNode
	open?: boolean
	onOpenChange?: (open: boolean) => void
}) {
	const {t} = useTranslation()
	const [activeCode, setActiveCode] = useLanguage()
	return (
		<SearchablePicker
			open={open}
			onOpenChange={onOpenChange}
			className='w-56'
			placeholder={t('language.search')}
			value={activeCode}
			onSelect={(code) => setActiveCode(code as SupportedLanguageCode)}
			items={languages.map((language) => ({
				value: language.code,
				label: language.name,
				keywords: [language.englishName],
				// Each name is in its own language, so it's drawn and read out as such
				lang: language.code,
				icon: (
					<span className='flex size-6 items-center justify-center rounded-6 bg-white/10 text-12 leading-none font-semibold'>
						{language.glyph}
					</span>
				),
			}))}
		>
			{children ?? (
				<Button>
					{languages.find(({code}) => code === activeCode)?.name}
					<ChevronDown />
				</Button>
			)}
		</SearchablePicker>
	)
}
