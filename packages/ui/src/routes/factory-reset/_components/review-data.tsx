import {useTranslation} from 'react-i18next'
import {TbServer, TbShoppingBag, TbUser, TbUsers} from 'react-icons/tb'
import {useNavigate} from 'react-router-dom'

import {Button} from '@/components/ui/button'
import {ButtonLink} from '@/components/ui/button-link'
import {ImmersiveDialogBody, ImmersiveDialogIconMessageKeyValue} from '@/components/ui/immersive-dialog'
import {LOADING_DASH} from '@/constants'
import {trpcReact} from '@/trpc/trpc'
import {maybePrettyBytes} from '@/utils/pretty-bytes'

import {backPath, description, title} from './misc'

export function ReviewData() {
	const {t, i18n} = useTranslation()
	const navigate = useNavigate()

	const userQ = trpcReact.user.get.useQuery()
	const accountsQ = trpcReact.user.listAccounts.useQuery()
	const userAppsQ = trpcReact.apps.list.useQuery()
	const diskQ = trpcReact.system.diskUsage.useQuery()

	const installedAppCount = userAppsQ.data?.length
	// A reset removes every account on the device, not just the owner's
	const accountCount = accountsQ.data?.length ?? 0
	const hasMembers = accountCount > 1
	const used = maybePrettyBytes(diskQ.data?.totalUsed, i18n.language)

	return (
		<>
			<ImmersiveDialogBody
				title={title()}
				description={description()}
				bodyText={t('factory-reset.review.following-will-be-removed')}
				footer={
					<>
						<Button size='dialog' className='min-w-0' onClick={() => navigate(backPath)}>
							{t('cancel')}
						</Button>
						<ButtonLink to='/factory-reset/confirm' variant='destructive' size='dialog' className='min-w-0'>
							{t('factory-reset.review.submit')}
						</ButtonLink>
					</>
				}
			>
				<ImmersiveDialogIconMessageKeyValue
					icon={hasMembers ? TbUsers : TbUser}
					k={hasMembers ? t('factory-reset.review.accounts-info') : t('factory-reset.review.account-info')}
					v={
						hasMembers ? (
							t('factory-reset.review.accounts', {count: accountCount})
						) : (
							<>
								<span>{userQ.data?.name}</span>
								<span className='max-sm:hidden'>
									<span className='mr-2 ml-2 opacity-50'>⋅</span>
									••••••••
								</span>
							</>
						)
					}
				/>
				<ImmersiveDialogIconMessageKeyValue
					icon={TbShoppingBag}
					k={t('factory-reset.review.apps')}
					v={
						installedAppCount === undefined
							? LOADING_DASH
							: t('factory-reset.review.installed-apps', {count: installedAppCount})
					}
				/>
				<ImmersiveDialogIconMessageKeyValue icon={TbServer} k={t('factory-reset.review.total-data')} v={used} />
			</ImmersiveDialogBody>
		</>
	)
}
