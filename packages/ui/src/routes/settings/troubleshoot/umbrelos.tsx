import {useTranslation} from 'react-i18next'

import {Button} from '@/components/ui/button'
import {ImmersiveDialogFooter} from '@/components/ui/immersive-dialog'
import {ImmersivePickerDialogContent} from '@/modules/immersive-picker'
import {LogResults, SystemLogType, TroubleshootTitleBackLink} from '@/routes/settings/troubleshoot/_shared'
import {trpcReact} from '@/trpc/trpc'

export default function TroubleshootUmbrelOs() {
	const {t} = useTranslation()
	const logs = useSystemLogs('system')

	return (
		<ImmersivePickerDialogContent>
			<div className='flex w-full items-center justify-between'>
				<TroubleshootTitleBackLink />
			</div>
			<LogResults>{logs}</LogResults>
			<ImmersiveDialogFooter className='justify-center'>
				<Button variant='primary' size='dialog' onClick={() => (window.location.href = '/logs')}>
					{t('troubleshoot.system-download', {label: t('troubleshoot.umbrelos-logs')})}
				</Button>
			</ImmersiveDialogFooter>
		</ImmersivePickerDialogContent>
	)
}

export function useSystemLogs(type: SystemLogType) {
	const {t} = useTranslation()
	const troubleshootQ = trpcReact.system.logs.useQuery({type})

	if (troubleshootQ.isLoading) return t('loading') + '...'
	if (troubleshootQ.isError) return troubleshootQ.error.message

	return troubleshootQ.data || t('troubleshoot-no-logs-yet')
}
