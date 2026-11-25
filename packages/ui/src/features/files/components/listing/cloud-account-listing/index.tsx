import {useEffect, useMemo} from 'react'
import {useTranslation} from 'react-i18next'
import {useParams, useNavigate as useRouterNavigate} from 'react-router-dom'

import {PillButton} from '@/components/ui/edge-controls'
import {CloudIcon} from '@/features/files/assets/cloud-icon'
import {CloudPlusIcon} from '@/features/files/assets/cloud-plus'
import {Listing, StateView} from '@/features/files/components/listing'
import {useSetActionsBarConfig} from '@/features/files/components/listing/actions-bar/actions-bar-context'
import {cloudSyncName, useCloudAccounts, useCloudSyncs} from '@/features/files/hooks/use-cloud'
import type {FileSystemItem} from '@/features/files/types'
import {useLinkToDialog} from '@/utils/dialog'

// Virtual /Cloud/<accountId> route: lists a connected account's download
// destination folders as a standard listing. Items carry their real
// destination paths, so folder badges, navigation, and the cloud
// context menu verbs all behave as in a normal directory view.
export function CloudAccountListing() {
	const {t} = useTranslation()
	const {accountId} = useParams<{accountId: string}>()
	const {data: clouds, isLoading} = useCloudSyncs()
	const {data: accounts} = useCloudAccounts()
	const routerNavigate = useRouterNavigate()
	const linkToDialog = useLinkToDialog()
	const setActionsBarConfig = useSetActionsBarConfig()

	const account = accounts?.find(({id}) => id === accountId)

	const items = useMemo<FileSystemItem[]>(
		() =>
			(clouds ?? [])
				.filter((cloud) => cloud.accountId === accountId)
				.map((cloud) => ({
					name: cloudSyncName(cloud),
					path: cloud.destination.path,
					type: 'directory' as const,
					size: 0,
					modified: cloud.lastSuccessfulAt ?? Date.now(),
					operations: [],
				}))
				.sort((a, b) => a.name.localeCompare(b.name)),
		[clouds, accountId],
	)

	const openAddWizard = () => routerNavigate(linkToDialog('files-cloud-add', account ? {account: account.id} : {}))

	useEffect(() => {
		setActionsBarConfig({
			hideSearch: true,
			// Selection is meaningless on the account's destination folders
			selectable: false,
			actions: [
				{
					id: 'add-download',
					label: t('files-cloud.add-download'),
					icon: CloudPlusIcon,
					onSelect: openAddWizard,
					pill: true,
				},
			],
		})
	}, [account?.id])

	const EmptyState = () => (
		<StateView icon={<CloudIcon className='size-12 opacity-60' />} title={t('files-cloud.account-empty')}>
			<PillButton icon={CloudPlusIcon} onClick={openAddWizard}>
				{t('files-cloud.add-download')}
			</PillButton>
		</StateView>
	)

	return (
		<Listing
			items={items}
			totalItems={items.length}
			selectableItems={items}
			isLoading={isLoading}
			hasMore={false}
			onLoadMore={async () => false}
			enableFileDrop={false}
			CustomEmptyView={EmptyState}
		/>
	)
}
