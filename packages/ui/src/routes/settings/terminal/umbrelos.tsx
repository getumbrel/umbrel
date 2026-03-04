import {useIsTouchDevice} from '@/features/files/hooks/use-is-touch-device'
import {ImmersivePickerDialogContent} from '@/modules/immersive-picker'
import {TerminalTitleBackLink, XTermTerminal} from '@/routes/settings/terminal/_shared'

export default function UmbrelOs() {
	const isTouchDevice = useIsTouchDevice()

	return (
		<ImmersivePickerDialogContent>
			<div className='flex w-full flex-wrap items-center justify-between'>
				<TerminalTitleBackLink />
			</div>
			{/* On touch devices, add padding to leave room for on-screen keyboard.
			40vh is a rough approximation. Dynamically detecting keyboard height
			triggers re-renders which would reset the terminal. */}
			{isTouchDevice ? (
				<div className='w-full flex-1 pb-[40vh]'>
					<XTermTerminal />
				</div>
			) : (
				<XTermTerminal />
			)}
		</ImmersivePickerDialogContent>
	)
}
