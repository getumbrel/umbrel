import {useState} from 'react'
import {useNavigate, useParams} from 'react-router-dom'

import {AppDropdown, ImmersivePickerDialogContent} from '@/modules/immersive-picker'
import {TerminalTitleBackLink, XTermTerminal} from '@/routes/settings/terminal/_shared'
import {DropdownMenu} from '@/shadcn-components/ui/dropdown-menu'

export function App() {
	const navigate = useNavigate()
	const {appId} = useParams<{appId: string}>()
	if (!appId) throw new Error('No app provided')
	const setAppId = (id: string) => navigate(`/settings/terminal/app/${id}`)

	const [open, setOpen] = useState(false)

	return (
		<ImmersivePickerDialogContent>
			<div className='flex w-full items-center justify-between'>
				<TerminalTitleBackLink />
				<DropdownMenu open={open} onOpenChange={setOpen}>
					<AppDropdown appId={appId} setAppId={setAppId} open={open} onOpenChange={setOpen} />
				</DropdownMenu>
			</div>
			<XTermTerminal appId={appId} />
		</ImmersivePickerDialogContent>
	)
}
