import {useTranslation} from 'react-i18next'
import {TbServer, TbShoppingBag, TbUser} from 'react-icons/tb'
import {useNavigate} from 'react-router-dom'

import {ImmersiveDialogBody, ImmersiveDialogIconMessageKeyValue} from '@/components/ui/immersive-dialog'
import {LinkButton} from '@/components/ui/link-button'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {Button} from '@/shadcn-components/ui/button'
import {trpcReact} from '@/trpc/trpc'
import {maybePrettyBytes} from '@/utils/pretty-bytes'

import {backPath, description, factoryResetTitle, title} from './misc'

export function ReviewData() {
	useUmbrelTitle(factoryResetTitle('Review data'))
	const navigate = useNavigate()

	const userQ = trpcReact.user.get.useQuery()
	const userAppsQ = trpcReact.user.apps.getAll.useQuery()
	const diskQ = trpcReact.system.diskUsage.useQuery()

	const installedAppCount = userAppsQ.data?.length
	const used = maybePrettyBytes(diskQ.data?.totalUsed)

	const {t} = useTranslation()

	return (
		<ImmersiveDialogBody
			title={title}
			description={description}
			bodyText='Following will be removed completely from your device'
			footer={
				<>
					<LinkButton to='/factory-reset/confirm' variant='destructive' size='dialog' className='min-w-0'>
						Continue
					</LinkButton>
					<Button size='dialog' className='min-w-0' onClick={() => navigate(backPath)}>
						Cancel
					</Button>
				</>
			}
		>
			<ImmersiveDialogIconMessageKeyValue icon={TbUser} k='Account Info' v={userQ.data?.name} />
			<ImmersiveDialogIconMessageKeyValue
				icon={TbShoppingBag}
				k='Apps'
				v={installedAppCount + ' installed ' + t('app', {count: installedAppCount})}
			/>
			<ImmersiveDialogIconMessageKeyValue icon={TbServer} k='Total data' v={used} />
		</ImmersiveDialogBody>
	)
}
