import {useState} from 'react'
import {TbChevronRight} from 'react-icons/tb'

import {ChevronDown} from '@/assets/chevron-down'
import {listClass, listItemClass} from '@/components/ui/list'
import {SegmentedControl} from '@/components/ui/segmented-control'
import {Button} from '@/shadcn-components/ui/button'
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from '@/shadcn-components/ui/dropdown-menu'
import {Switch} from '@/shadcn-components/ui/switch'

export function AppStorePreferencesContent() {
	const tabs = [
		{id: 'auto-update', label: 'Auto-update'},
		{id: 'notifications', label: 'Notifications'},
		{id: 'uninstall', label: 'Uninstall'},
	]
	const [activeTab, setActiveTab] = useState(tabs[0].id)

	return (
		<>
			<div className={listClass}>
				<label className={listItemClass}>
					<span>Allow a specific function</span>
					<Switch />
				</label>
				<div className={listItemClass}>
					Single value selector
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button size='sm'>
								Value label
								<ChevronDown />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent>
							<DropdownMenuCheckboxItem checked>English</DropdownMenuCheckboxItem>
							<DropdownMenuCheckboxItem>French</DropdownMenuCheckboxItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
				<label className={listItemClass}>
					Multi-level setting
					<TbChevronRight />
				</label>
			</div>
			<SegmentedControl size='lg' tabs={tabs} value={activeTab} onValueChange={setActiveTab} />
			<div className={listClass}>
				<label className={listItemClass}>Auto-update all apps</label>
			</div>
			<div className={listClass}>
				<div className={listItemClass}>
					<span>Lighting node</span>
					<Button size='sm' className='text-destructive2-lightest'>
						Uninstall
					</Button>
				</div>
				<div className={listItemClass}>
					<span>Lighting node</span>
					<Button size='sm' className='text-destructive2-lightest'>
						Uninstall
					</Button>
				</div>
			</div>
		</>
	)
}
