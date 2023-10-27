import {useState} from 'react'
import {TbChevronRight} from 'react-icons/tb'
import {useNavigate} from 'react-router-dom'

import {ChevronDown} from '@/assets/chevron-down'
import {DialogMounter} from '@/components/dialog-mounter'
import {SegmentedControl} from '@/components/ui/segmented-control'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {Button} from '@/shadcn-components/ui/button'
import {Dialog, DialogContent, DialogHeader, DialogPortal, DialogTitle} from '@/shadcn-components/ui/dialog'
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from '@/shadcn-components/ui/dropdown-menu'
import {Switch} from '@/shadcn-components/ui/switch'
import {useAfterDelayedClose} from '@/utils/dialog'
import {tw} from '@/utils/tw'

export function AppStorePreferencesDialog() {
	const title = 'App Store Preferences'
	useUmbrelTitle(title)
	const navigate = useNavigate()

	const tabs = [
		{id: 'auto-update', label: 'Auto-update'},
		{id: 'notifications', label: 'Notifications'},
		{id: 'uninstall', label: 'Uninstall'},
	]
	const [activeTab, setActiveTab] = useState(tabs[0].id)

	const [open, setOpen] = useState(true)

	useAfterDelayedClose(open, () => navigate('/settings', {preventScrollReset: true}))

	return (
		<DialogMounter>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogPortal>
					<DialogContent className='p-0'>
						<div className='umbrel-dialog-fade-scroller space-y-6 overflow-y-auto px-5 py-6'>
							<DialogHeader>
								<DialogTitle>App store</DialogTitle>
							</DialogHeader>
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
						</div>
					</DialogContent>
				</DialogPortal>
			</Dialog>
		</DialogMounter>
	)
}

const listClass = tw`divide-y divide-white/6 overflow-hidden rounded-12 bg-white/6`
const listItemClass = tw`flex items-center gap-3 px-3 h-[50px] text-15 font-medium -tracking-3 justify-between`
