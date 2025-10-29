import {useId, useState} from 'react'

import {ListRadioItem} from '@/components/ui/list'
import {useLanguage} from '@/hooks/use-language'
import {useSettingsDialogProps} from '@/routes/settings/_components/shared'
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerHeader,
	DrawerScroller,
	DrawerTitle,
} from '@/shadcn-components/ui/drawer'
import {t} from '@/utils/i18n'
import {languages, SupportedLanguageCode} from '@/utils/language'
import {sleep} from '@/utils/misc'

export function LanguageDrawer() {
	const title = t('language')
	const dialogProps = useSettingsDialogProps()
	const [activeCode, setActiveCode] = useLanguage()
	const [temporaryCode, setTemporaryCode] = useState(activeCode)

	const changeLanguage = async (code: SupportedLanguageCode) => {
		// Using this janky approach with a temporary code because we want to show feedback right away
		// and also close the dialog (which updates the page URL), so the timeout causes the page refresh to happen
		// at the desired url
		setTemporaryCode(code)
		// Delay so user can see the checkmark
		await sleep(200)
		dialogProps.onOpenChange(false)
		setTimeout(() => setActiveCode(code), 200)
	}

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
								checked={temporaryCode === code}
								onSelect={() => changeLanguage(code)}
								disabled={temporaryCode !== activeCode}
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
