import {ImmersivePickerDialogContent} from '@/modules/immersive-picker'
import {TerminalTitleBackLink, XTermTerminal} from '@/routes/settings/terminal/_shared'

export default function UmbrelOs() {
	return (
		<ImmersivePickerDialogContent>
			<div className='flex w-full flex-wrap items-center justify-between'>
				<TerminalTitleBackLink />
			</div>
			<XTermTerminal />
		</ImmersivePickerDialogContent>
	)
}
