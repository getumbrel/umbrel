import {useTranslation} from 'react-i18next'

import {SidebarItem} from '@/features/files/components/sidebar/sidebar-item'
import {useMemberShares} from '@/features/files/hooks/use-member-shares'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {AccountAvatar} from '@/modules/auth/account-avatar'

// The owner's Umbrel as a single folder entry in a member's sidebar. It roots
// at /Home, members can navigate down from there but only see the whitelisted
// paths leading to what's been shared with them.
export function SidebarOwnersUmbrel({name}: {name: string}) {
	const {navigateToDirectory, currentPath} = useNavigate()
	const {sharedWithMe} = useMemberShares()

	return (
		<SidebarItem
			item={{name, path: '/Home', type: 'directory'}}
			isActive={currentPath === '/Home' || currentPath.startsWith('/Home/')}
			onClick={() => navigateToDirectory('/Home')}
			icon={
				sharedWithMe ? (
					// The owner's account id is the system-wide constant '0' (OWNER_USER_ID
					// in umbreld), giving the same deterministic gradient as login/settings
					<AccountAvatar name={sharedWithMe.ownerName} userId='0' avatarUrl={sharedWithMe.ownerAvatarUrl} size={20} />
				) : undefined
			}
		/>
	)
}

// Category-wide storage grants. The root entries automatically include devices
// and network shares connected after the permission was granted.
export function SidebarSharedStorage({external, network, raid}: {external: boolean; network: boolean; raid?: boolean}) {
	const {t} = useTranslation()
	const {navigateToDirectory, currentPath} = useNavigate()

	type SharedStorageCategory = {
		path: string
		name: string
		type: 'external-storage' | 'network-root' | 'directory'
	}
	const categories = [
		external ? {path: '/External', name: t('files-sidebar.external-storage'), type: 'external-storage' as const} : null,
		network ? {path: '/Network', name: t('files-sidebar.network'), type: 'network-root' as const} : null,
		raid ? {path: '/Raid', name: t('files-sidebar.raid-storage'), type: 'directory' as const} : null,
	].filter((category): category is SharedStorageCategory => category !== null)

	return (
		<>
			{categories.map((category) => (
				<SidebarItem
					key={category.path}
					item={category}
					isActive={currentPath === category.path || currentPath.startsWith(`${category.path}/`)}
					onClick={() => navigateToDirectory(category.path)}
				/>
			))}
		</>
	)
}
