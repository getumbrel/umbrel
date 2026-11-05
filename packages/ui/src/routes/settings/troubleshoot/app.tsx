import {useTranslation} from 'react-i18next'
import {useNavigate} from 'react-router-dom'

import {Button} from '@/components/ui/button'
import {ImmersiveDialogFooter} from '@/components/ui/immersive-dialog'
import {LOADING_DASH} from '@/constants'
import {AppDropdown, ImmersivePickerDialogContent} from '@/modules/immersive-picker'
import {usePickerTarget} from '@/modules/immersive-picker/target'
import {useUserApp} from '@/providers/apps'
import {downloadUtf8Logs, LogResults, TroubleshootTitleBackLink} from '@/routes/settings/troubleshoot/_shared'
import {trpcReact} from '@/trpc/trpc'

export function TroubleshootApp({appId}: {appId: string}) {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const {linkToTarget} = usePickerTarget('troubleshoot')
	const setAppId = (id: string) => navigate(linkToTarget({type: 'app', appId: id}))

	const {app} = useUserApp(appId)

	const {logs, text: logsText} = useAppLogs(appId)

	return (
		<ImmersivePickerDialogContent>
			<div className='flex w-full flex-wrap items-center justify-between gap-2 pe-6'>
				<TroubleshootTitleBackLink />
				<AppDropdown appId={appId} setAppId={setAppId} />
			</div>
			{logsText && <LogResults>{logsText}</LogResults>}
			<ImmersiveDialogFooter className='justify-center'>
				<Button
					variant='primary'
					size='dialog'
					disabled={!appId || !logs}
					onClick={() => logs && downloadUtf8Logs(logs, appId)}
				>
					{t('troubleshoot.app-download', {app: app?.name || LOADING_DASH})}
				</Button>
				{/* <Button size='dialog'>{t('troubleshoot.share-with-umbrel-support')}</Button> */}
			</ImmersiveDialogFooter>
		</ImmersivePickerDialogContent>
	)
}

// The logs to download, apart from the text shown in their place while there are none,
// so a download can never save "Loading..." or an error as the app's logs
function useAppLogs(appId: string) {
	const {t} = useTranslation()
	const troubleshootQ = trpcReact.apps.logs.useQuery({appId})
	const logs = troubleshootQ.data || undefined

	const text = troubleshootQ.isLoading
		? t('loading') + '…'
		: troubleshootQ.isError
			? troubleshootQ.error.message
			: logs || t('troubleshoot-no-logs-yet')

	return {logs, text}
}
