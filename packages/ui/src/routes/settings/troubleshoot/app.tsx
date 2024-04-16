import {useState} from 'react'
import {useNavigate, useParams} from 'react-router-dom'

import {ImmersiveDialogFooter} from '@/components/ui/immersive-dialog'
import {LOADING_DASH} from '@/constants'
import {useUserApp} from '@/providers/apps'
import {
	downloadUtf8Logs,
	LogResults,
	TroubleshootDropdown,
	TroubleshootTitleBackButton,
} from '@/routes/settings/troubleshoot/_shared'
import {Button} from '@/shadcn-components/ui/button'
import {DropdownMenu} from '@/shadcn-components/ui/dropdown-menu'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

export function TroubleshootApp() {
	const navigate = useNavigate()
	const {appId} = useParams<{appId: string}>()
	if (!appId) throw new Error('No app provided')
	const setAppId = (id: string) => navigate(`/settings/troubleshoot/app/${id}`)

	const {app} = useUserApp(appId)
	const [open, setOpen] = useState(false)

	const appLogs = useAppLogs(appId)

	return (
		<>
			<div className='flex w-full items-center justify-between'>
				<TroubleshootTitleBackButton />
				<DropdownMenu open={open} onOpenChange={setOpen}>
					<TroubleshootDropdown appId={appId} setAppId={setAppId} open={open} onOpenChange={setOpen} />
				</DropdownMenu>
			</div>
			{appLogs && <LogResults>{appLogs}</LogResults>}
			<ImmersiveDialogFooter className='justify-center'>
				<Button variant='primary' size='dialog' disabled={!appId} onClick={() => downloadUtf8Logs(appLogs, appId)}>
					{t('troubleshoot.app-download', {app: app?.name || LOADING_DASH})}
				</Button>
				{/* <Button size='dialog'>{t('troubleshoot.share-with-umbrel-support')}</Button> */}
			</ImmersiveDialogFooter>
		</>
	)
}

function useAppLogs(appId: string) {
	const troubleshootQ = trpcReact.apps.logs.useQuery({appId})

	if (troubleshootQ.isLoading) return t('loading') + '...'
	if (troubleshootQ.isError) return troubleshootQ.error.message

	return troubleshootQ.data || t('troubleshoot-no-logs-yet')
}
