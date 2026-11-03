import {useId} from 'react'
import {useTranslation} from 'react-i18next'

import {useDrawerOrDialog} from '@/components/ui/drawer-or-dialog'
import {ListRadioItem} from '@/components/ui/list'
import {useLanguage} from '@/hooks/use-language'
import {useSettingsDialogProps} from '@/routes/settings/_components/shared'
import {languages} from '@/utils/language'

export function LanguageDrawerOrDialog() {
	const {t} = useTranslation()
	const title = t('settings.language')
	const dialogProps = useSettingsDialogProps()
	const {Root, Content, Header, Title, Description, Scroller} = useDrawerOrDialog()
	const [activeCode, setActiveCode] = useLanguage()

	const languageRadioName = useId()

	return (
		<Root {...dialogProps}>
			<Content fullHeight>
				<Header>
					<Title>{title}</Title>
					<Description>{t('settings.language-description')}</Description>
				</Header>

				<Scroller>
					<section className='flex flex-col gap-2'>
						<div className='divide-y divide-white/6 rounded-12 bg-white/6'>
							{languages.map(({code, name, glyph}) => (
								<ListRadioItem
									key={code}
									name={languageRadioName}
									checked={activeCode === code}
									onSelect={() => setActiveCode(code)}
								>
									{/* Each name is in its own language, so it's drawn and read out as such */}
									<span lang={code} className='flex items-center gap-3'>
										<span className='flex h-6 w-6 shrink-0 items-center justify-center rounded-5 bg-white/10 text-12 leading-none font-semibold'>
											{glyph}
										</span>
										{name}
									</span>
								</ListRadioItem>
							))}
						</div>
					</section>
				</Scroller>
			</Content>
		</Root>
	)
}
