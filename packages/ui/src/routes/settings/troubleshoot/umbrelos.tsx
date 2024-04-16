import {useNavigate, useParams} from 'react-router-dom'

import {ImmersiveDialogFooter} from '@/components/ui/immersive-dialog'
import {SegmentedControl} from '@/components/ui/segmented-control'
import {
	downloadUtf8Logs,
	LogResults,
	SystemLogType,
	TroubleshootTitleBackButton,
} from '@/routes/settings/troubleshoot/_shared'
import {Button} from '@/shadcn-components/ui/button'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

export default function TroubleshootUmbrelOs() {
	const tabs = [
		{id: 'umbrelos', label: t('troubleshoot.umbrelos-logs')},
		{id: 'system', label: t('troubleshoot.system-logs')},
	] as const satisfies readonly {id: SystemLogType; label: string}[]

	const defaultTab = tabs[0].id
	// const [activeTab, setActiveTab] = useLocalStorage2<SystemLogType>('troubleshoot-system-active-tab', defaultTab)

	const navigate = useNavigate()
	const params = useParams<{systemTab: SystemLogType}>()
	const activeTab = params.systemTab ?? defaultTab
	const setActiveTab = (tab: SystemLogType) => {
		navigate(`/settings/troubleshoot/umbrelos/${tab}`, {
			replace: true,
		})
	}
	const logs = useSystemLogs(activeTab ?? defaultTab)

	const activeLabel = tabs.find((tab) => tab.id === activeTab)?.label

	return (
		<>
			<div className='flex w-full flex-wrap items-center justify-between'>
				<TroubleshootTitleBackButton />
				<SegmentedControl size='lg' tabs={tabs} value={activeTab} onValueChange={setActiveTab} />
			</div>
			<LogResults key={activeTab}>{logs}</LogResults>
			<ImmersiveDialogFooter className='justify-center'>
				<Button variant='primary' size='dialog' onClick={() => downloadUtf8Logs(logs, activeTab)}>
					{t('troubleshoot.system-download', {label: activeLabel})}
				</Button>
				{/* <Button size='dialog'>{t('troubleshoot.share-with-umbrel-support')}</Button> */}
			</ImmersiveDialogFooter>
		</>
	)
}

export function useSystemLogs(type: SystemLogType) {
	const troubleshootQ = trpcReact.system.logs.useQuery({type})

	if (troubleshootQ.isLoading) return t('loading') + '...'
	if (troubleshootQ.isError) return troubleshootQ.error.message

	return troubleshootQ.data || t('troubleshoot-no-logs-yet')
}
