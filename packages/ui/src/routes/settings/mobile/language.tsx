import {useId} from 'react'
import {useTranslation} from 'react-i18next'

import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerHeader,
	DrawerScroller,
	DrawerTitle,
} from '@/components/ui/drawer'
import {ListRadioItem} from '@/components/ui/list'
import {useLanguage} from '@/hooks/use-language'
import {useSettingsDialogProps} from '@/routes/settings/_components/shared'
import {languages} from '@/utils/language'

export function LanguageDrawer() {
	const {t} = useTranslation()
	const title = t('language')
	const dialogProps = useSettingsDialogProps()
	const [activeCode, setActiveCode] = useLanguage()

	const radioName = useId()

	return (
		<Drawer {...dialogProps}>
			<DrawerContent fullHeight>
				<DrawerHeader>
					<DrawerTitle>{title}</DrawerTitle>
					<DrawerDescription>{t('language.select-description')}</DrawerDescription>
				</DrawerHeader>

				<DrawerScroller>
					<div className='divide-y divide-white/6 rounded-12 bg-white/6'>
						{languages.map(({code, name}) => (
							<ListRadioItem
								key={code}
								name={radioName}
								checked={activeCode === code}
								onSelect={() => setActiveCode(code)}
							>
								{name}
							</ListRadioItem>
						))}
					</div>
				</DrawerScroller>
			</DrawerContent>
		</Drawer>
	)
}
