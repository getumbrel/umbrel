import {useId} from 'react'

import {listClass, ListRadioItem} from '@/components/ui/list'
import {languages, useLanguage} from '@/hooks/use-language'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerFooter,
	DrawerHeader,
	DrawerTitle,
} from '@/shadcn-components/ui/drawer'
import {useDialogOpenProps} from '@/utils/dialog'
import {sleep} from '@/utils/misc'

export function LanguageDrawer() {
	const title = 'Language'
	useUmbrelTitle(title)
	const dialogProps = useDialogOpenProps('language')
	const [activeCode, setActiveCode] = useLanguage()

	const changeLanguage = async (code: string) => {
		setActiveCode(code)
		// Delay so user can see the checkmark
		await sleep(200)
		dialogProps.onOpenChange(false)
	}

	const radioName = useId()

	return (
		<Drawer {...dialogProps}>
			<DrawerContent>
				<DrawerHeader>
					<DrawerTitle>{title}</DrawerTitle>
					<DrawerDescription>Select preferred interface language</DrawerDescription>
				</DrawerHeader>

				<div className={listClass}>
					{languages.map(({code, name}) => (
						<ListRadioItem
							key={code}
							name={radioName}
							checked={activeCode === code}
							onSelect={() => changeLanguage(code)}
						>
							{name}
						</ListRadioItem>
					))}
				</div>

				{/* Spacing to match figma */}
				<div className='h-[80px]' />
				{/* empty `DrawerFooter` adding bottom spacing */}
				<DrawerFooter></DrawerFooter>
			</DrawerContent>
		</Drawer>
	)
}
