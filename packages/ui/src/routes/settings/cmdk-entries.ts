import {useMemo} from 'react'
import {useTranslation} from 'react-i18next'
import {resolvePath, useLocation, useNavigate, type Location} from 'react-router-dom'

import {type CmdkEntry} from '@/components/cmdk-search'
import {useBackups} from '@/features/backups/hooks/use-backups'
import {useIsHomeOrPro} from '@/hooks/use-is-home-or-pro'
import {systemAppsKeyed} from '@/providers/apps'
import {trpcReact} from '@/trpc/trpc'

import {
	createSettingsCatalog,
	getDefaultSettingsCommandItems,
	getSettingsCommandItems,
	getSettingsCommandTarget,
} from './_components/settings-catalog'

// Every settings page and action as a command palette entry, found by its
// title, description, and the copy nested inside the page.
export function useSettingsCmdkEntries(): CmdkEntry[] {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const location = useLocation()
	const {deviceName} = useIsHomeOrPro()
	const userQ = trpcReact.user.get.useQuery()
	const isMember = userQ.data?.role === 'member'
	const {repositories} = useBackups({repositoriesEnabled: Boolean(userQ.data) && !isMember})

	const hasUser = Boolean(userQ.data)
	const sambaEnabled = userQ.data?.sambaEnabled === true
	const hasRepositories = (repositories?.length ?? 0) > 0

	// Built once per input change, not per keystroke: the catalog resolves
	// every page's copy through t(), and the palette re-renders as you type
	return useMemo(() => {
		if (!hasUser) return []

		const catalog = createSettingsCatalog(t, {deviceName, isMember, sambaEnabled})
		const defaultItems = new Set(getDefaultSettingsCommandItems(catalog))

		return getSettingsCommandItems(catalog).map((item) => ({
			id: `settings:${item.id}`,
			title: item.title,
			subtitle: `${t('generic-in')} ${t('settings')}`,
			keywords: [item.description, ...(item.keywords ?? [])].filter((keyword) => keyword !== undefined),
			default: defaultItems.has(item),
			icon: systemAppsKeyed['UMBREL_settings'].icon,
			onSelect: () => {
				const target = getSettingsCommandTarget(item)
				if (target.type === 'external') window.open(target.to, '_blank', 'noopener,noreferrer')
				else if (target.type === 'backups') {
					navigate(hasRepositories ? '/settings/backups/configure' : '/settings/backups/setup')
				} else if (target.type === 'current-location-dialog') {
					navigate(addDialogToLocation(location, target.dialog))
				} else {
					navigate(target.to, {replace: shouldReplaceSettingsNavigation(location.pathname, target.to)})
				}
			},
		}))
	}, [t, navigate, location, deviceName, isMember, sambaEnabled, hasUser, hasRepositories])
}

export function addDialogToLocation(location: Pick<Location, 'pathname' | 'search' | 'hash'>, dialog: 'logout') {
	const search = new URLSearchParams(location.search)
	search.set('dialog', dialog)
	return {pathname: location.pathname, search: search.toString(), hash: location.hash}
}

export function shouldReplaceSettingsNavigation(currentPathname: string, to: string) {
	return resolvePath(to, currentPathname).pathname === currentPathname
}
