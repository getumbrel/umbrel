import {useState} from 'react'
import {useNavigate, useParams} from 'react-router-dom'

import {DropdownMenu} from '@/components/ui/dropdown-menu'
import {useIsTouchDevice} from '@/features/files/hooks/use-is-touch-device'
import {AppDropdown, ImmersivePickerDialogContent} from '@/modules/immersive-picker'
import {TerminalTitleBackLink, XTermTerminal} from '@/routes/settings/terminal/_shared'

export function App() {
	const navigate = useNavigate()
	const {appId} = useParams<{appId: string}>()
	if (!appId) throw new Error('No app provided')
	const setAppId = (id: string) => navigate(`/settings/terminal/app/${id}`)

	const [open, setOpen] = useState(false)
	const isTouchDevice = useIsTouchDevice()

	return (
		<ImmersivePickerDialogContent>
			<div className='flex w-full items-center justify-between'>
				<TerminalTitleBackLink />
				<DropdownMenu open={open} onOpenChange={setOpen}>
					<AppDropdown appId={appId} setAppId={setAppId} open={open} onOpenChange={setOpen} />
				</DropdownMenu>
			</div>
			{/* On touch devices, add padding to leave room for on-screen keyboard.
			40vh is a rough approximation. Dynamically detecting keyboard height
			triggers re-renders which would reset the terminal. */}
			{isTouchDevice ? (
				<div className='w-full flex-1 pb-[40vh]'>
					<XTermTerminal appId={appId} />
				</div>
			) : (
				<XTermTerminal appId={appId} />
			)}
		</ImmersivePickerDialogContent>
	)
}
