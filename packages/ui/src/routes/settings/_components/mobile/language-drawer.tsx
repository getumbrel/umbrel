import {useState} from 'react'
import {TbCheck} from 'react-icons/tb'
import {useNavigate} from 'react-router-dom'

import {languages, useLanguage} from '@/hooks/use-language'
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerFooter,
	DrawerHeader,
	DrawerTitle,
} from '@/shadcn-components/ui/drawer'
import {cn} from '@/shadcn-lib/utils'
import {useAfterDelayedClose} from '@/utils/dialog'
import {listClass, listItemClass} from '@/utils/element-classes'
import {sleep} from '@/utils/misc'

export function LanguageDrawer() {
	const [open, setOpen] = useState(true)
	const navigate = useNavigate()

	const [activeCode, setActiveCode] = useLanguage()

	useAfterDelayedClose(open, () => navigate('/settings', {preventScrollReset: true}))

	const changeLanguage = async (code: string) => {
		setActiveCode(code)
		// Delay so user can see the checkmark
		await sleep(200)
		setOpen(false)
	}

	return (
		<Drawer open={open} onOpenChange={setOpen}>
			<DrawerContent>
				<DrawerHeader>
					<DrawerTitle>Language</DrawerTitle>
					<DrawerDescription>Select preferred interface language</DrawerDescription>
				</DrawerHeader>
				<div className='px-5'>
					<div className={listClass}>
						{languages.map(({code, name}) => (
							<ListCheckItem key={code} checked={activeCode === code} onSelect={() => changeLanguage(code)}>
								{name}
							</ListCheckItem>
						))}
					</div>
				</div>
				{/* Spacing to match figma */}
				<div className='h-[80px]' />
				{/* empty `DrawerFooter` adding bottom spacing */}
				<DrawerFooter></DrawerFooter>
			</DrawerContent>
		</Drawer>
	)
}

function ListCheckItem({
	children,
	checked,
	onSelect,
}: {
	children: React.ReactNode
	checked: boolean
	onSelect: () => void
}) {
	return (
		<div className={cn(listItemClass, 'relative')}>
			{children}
			{checked && <TbCheck className='h-4 w-4' />}
			<input
				type='checkbox'
				checked={checked}
				onChange={onSelect}
				className='absolute inset-0 appearance-none bg-red-500 opacity-0'
			/>
		</div>
	)
}
