import {TbServer, TbShoppingBag, TbUser} from 'react-icons/tb'
import {useNavigate} from 'react-router-dom'

import {ButtonLink} from '@/components/ui/button-link'
import {ImmersiveDialogBody, ImmersiveDialogIconMessageKeyValue} from '@/components/ui/immersive-dialog'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {Button} from '@/shadcn-components/ui/button'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'
import {maybePrettyBytes} from '@/utils/pretty-bytes'

import {backPath, description, factoryResetTitle, title} from './misc'

export function ReviewData() {
	useUmbrelTitle(factoryResetTitle(t('factory-reset.review.title')))
	const navigate = useNavigate()

	const userQ = trpcReact.user.get.useQuery()
	const userAppsQ = trpcReact.apps.list.useQuery()
	const diskQ = trpcReact.system.diskUsage.useQuery()

	const installedAppCount = userAppsQ.data?.length
	const used = maybePrettyBytes(diskQ.data?.totalUsed)

	return (
		<ImmersiveDialogBody
			title={title()}
			description={description()}
			bodyText={t('factory-reset.review.following-will-be-removed')}
			footer={
				<>
					<ButtonLink to='/factory-reset/confirm' variant='destructive' size='dialog' className='min-w-0'>
						{t('factory-reset.review.submit')}
					</ButtonLink>
					<Button size='dialog' className='min-w-0' onClick={() => navigate(backPath)}>
						{t('cancel')}
					</Button>
				</>
			}
		>
			<ImmersiveDialogIconMessageKeyValue
				icon={TbUser}
				k={t('factory-reset.review.account-info')}
				v={userQ.data?.name}
			/>
			<ImmersiveDialogIconMessageKeyValue
				icon={TbShoppingBag}
				k={t('factory-reset.review.apps')}
				v={t('factory-reset.review.installed-apps', {count: installedAppCount})}
			/>
			<ImmersiveDialogIconMessageKeyValue icon={TbServer} k={t('factory-reset.review.total-data')} v={used} />
		</ImmersiveDialogBody>
	)
}
