import {useNavigate} from 'react-router-dom'

import {useIsTouchDevice} from '@/features/files/hooks/use-is-touch-device'
import {AppDropdown, ImmersivePickerDialogContent} from '@/modules/immersive-picker'
import {usePickerTarget} from '@/modules/immersive-picker/target'
import {TerminalTitleBackLink, XTermTerminal} from '@/routes/settings/terminal/_shared'

export function App({appId}: {appId: string}) {
	const navigate = useNavigate()
	const {linkToTarget} = usePickerTarget('terminal')
	const setAppId = (id: string) => navigate(linkToTarget({type: 'app', appId: id}))

	const isTouchDevice = useIsTouchDevice()

	return (
		<ImmersivePickerDialogContent>
			<div className='flex w-full flex-wrap items-center justify-between gap-2 pe-6'>
				<TerminalTitleBackLink />
				<AppDropdown appId={appId} setAppId={setAppId} />
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
