import {TFunction} from 'i18next'
import {matchSorter} from 'match-sorter'
import {type IconType} from 'react-icons'
import {BsFillQuestionCircleFill} from 'react-icons/bs'
import {FaShield} from 'react-icons/fa6'
import {HiMiniRectangleStack} from 'react-icons/hi2'
import {IoIosSettings} from 'react-icons/io'
import {
	PiAppWindowFill,
	PiArrowCircleUpFill,
	PiClockCounterClockwiseFill,
	PiDevicesFill,
	PiKeyFill,
	PiShareNetworkFill,
	PiUsersThreeFill,
	PiWrenchFill,
} from 'react-icons/pi'
import {TbSparkles} from 'react-icons/tb'

import {normalizeSearchText} from '@/components/cmdk-search'
import {links} from '@/constants/links'
import {type GlobalDialogKey} from '@/utils/dialog'

import {SETTINGS_CATEGORY_IDS, SettingsCategoryId, SettingsFilterId, suppliedSettingsIcons} from './settings-taxonomy'

export type SettingsItemId =
	| 'account'
	| 'sessions'
	| 'wallpaper'
	| 'widgets'
	| '2fa'
	| 'users'
	| 'language'
	| 'wifi'
	| 'storage'
	| 'apps'
	| 'migration'
	| 'device-info'
	| 'mcp'
	| 'file-sharing'
	| 'backups'
	| 'advanced'
	| 'software-update'
	| 'troubleshoot'
	| 'support'
	| 'logout'
	| 'restart'
	| 'shutdown'
	| 'change-name'
	| 'change-password'
	| 'remote-tor-access'
	| 'terminal'
	| 'factory-reset'
	| 'beta-program'
	| 'network'
	| 'https-access'
	| 'external-dns'
	| 'backups-restore'
	| 'backups-rewind'

export type SettingsItemIcon = IconType | string

const SETTINGS_PAGE_ITEM_ORDER: SettingsItemId[] = [
	'change-name',
	'change-password',
	'2fa',
	'users',
	'wallpaper',
	'widgets',
	'sessions',
	'language',
	'storage',
	'apps',
	'file-sharing',
	'backups',
	'migration',
	'software-update',
	'wifi',
	'device-info',
	'mcp',
	'advanced',
	'troubleshoot',
	'support',
]

const settingsPageItemOrder = new Map(SETTINGS_PAGE_ITEM_ORDER.map((id, index) => [id, index]))

type SettingsCatalogItemBase = {
	id: SettingsItemId
	title: string
	description?: string
	keywords?: string[]
}

export type SettingsCommandTarget =
	| {type: 'navigate'; to: string}
	| {type: 'external'; to: string}
	| {type: 'backups'}
	| {type: 'current-location-dialog'; dialog: GlobalDialogKey}

type SettingsPageCommand = {
	default?: boolean
	/** Where the command leads, when that isn't the page's own `to` */
	target?: Exclude<SettingsCommandTarget, {type: 'navigate' | 'external'}>
}

export type SettingsPageItem = SettingsCatalogItemBase & {
	kind: 'page'
	category: SettingsCategoryId
	icon: SettingsItemIcon
	description: string
	to: string
	external?: boolean
	command?: SettingsPageCommand
	/** Overrides the item's position in SETTINGS_PAGE_ITEM_ORDER */
	order?: number
}

export type SettingsCommandItem = SettingsCatalogItemBase & {
	kind: 'command'
	default?: boolean
	target: SettingsCommandTarget
}

export type SettingsCatalogItem = SettingsPageItem | SettingsCommandItem
export type SettingsCommandCatalogItem = (SettingsPageItem & {command: SettingsPageCommand}) | SettingsCommandItem

export type SettingsPage = {
	itemsByCategory: Record<SettingsCategoryId, SettingsPageItem[]>
	categoryIds: SettingsCategoryId[]
	items: SettingsPageItem[]
}

export function createSettingsCatalog(
	t: TFunction,
	{
		deviceName,
		isMember = false,
		memberName,
		sambaEnabled = false,
	}: {deviceName: string; isMember?: boolean; memberName?: string; sambaEnabled?: boolean},
): SettingsCatalogItem[] {
	const pageItems: SettingsPageItem[] = [
		{
			kind: 'page',
			id: 'wallpaper',
			category: 'account',
			command: {default: true},
			icon: suppliedSettingsIcons.wallpaper,
			title: t('wallpaper'),
			description: t('wallpaper-description'),
			to: '/settings/wallpaper',
			keywords: [t('cmdk.change-wallpaper')],
		},
		{
			kind: 'page',
			id: 'widgets',
			category: 'account',
			command: {default: true},
			icon: HiMiniRectangleStack,
			title: t('cmdk.widgets'),
			description: t('widgets.description'),
			to: '/edit-widgets',
			keywords: [t('desktop.context-menu.edit-widgets')],
		},
		{
			kind: 'page',
			id: 'users',
			category: 'account',
			command: {},
			icon: PiUsersThreeFill,
			title: t('users'),
			description: t('users.description'),
			to: '/settings/users',
			keywords: [
				'session',
				'sessions',
				t('account'),
				t('account-description'),
				t('change-name'),
				t('change-name.input-placeholder'),
				t('change-password'),
				t('change-password.description'),
				t('change-password.current-password'),
				t('change-password.new-password'),
				t('change-password.repeat-password'),
				t('change-password.callout'),
				t('2fa'),
				t('2fa-description'),
				t('2fa.enable.title'),
				t('2fa.disable.title'),
				t('users.members'),
				t('users.add-title'),
				t('users.create-user'),
				t('users.reset-password'),
				t('users.storage-access'),
				t('users.network-storage'),
				t('users.network-storage-description'),
				t('users.usb-storage'),
				t('users.usb-storage-description'),
				t('users.shared-apps'),
				t('users.shared-folders'),
				t('users.share-all-apps-description'),
				t('users.share-all-folders-description'),
				t('active-logins.title'),
				t('active-logins.description'),
				t('active-logins.current'),
				t('active-logins.last-active-ago'),
				t('active-logins.managed-description'),
			],
		},
		{
			kind: 'page',
			id: 'language',
			category: 'account',
			command: {},
			icon: suppliedSettingsIcons.language,
			title: t('settings.language'),
			description: t('settings.language-description'),
			to: '/settings/language',
			keywords: [t('language'), t('language-description')],
		},
		{
			kind: 'page',
			id: 'wifi',
			category: 'system',
			command: {},
			icon: suppliedSettingsIcons.wifi,
			title: t('wifi'),
			description: t('wifi-description'),
			to: '/settings/wifi',
			keywords: [
				'wifi',
				t('wifi-description-long'),
				t('wifi-view-networks'),
				t('wifi-searching'),
				t('wifi-no-networks-message'),
				t('connect'),
				t('password'),
				t('disable'),
			],
		},
		{
			kind: 'page',
			id: 'storage',
			category: 'storage',
			command: {},
			icon: suppliedSettingsIcons.storageManager,
			title: t('storage-manager'),
			description: t('storage-manager.description'),
			to: '/settings/storage',
			keywords: [
				t('storage-manager.mode'),
				t('storage-manager.mode.failsafe'),
				t('storage-manager.mode.failsafe.description'),
				t('storage-manager.mode.full-storage'),
				t('storage-manager.mode.full-storage.description'),
				t('storage-manager.available-storage'),
				t('storage-manager.health.title'),
				t('storage-manager.health.title-drive'),
				t('storage-manager.health.health-status'),
				t('storage-manager.health.estimated-life'),
				t('storage-manager.health.temperature'),
				t('storage-manager.add-to-raid.title'),
				t('storage-manager.install-ssd.title'),
				t('storage-manager.swap'),
				t('storage-manager.replace'),
			],
		},
		{
			kind: 'page',
			id: 'apps',
			category: 'storage',
			command: {},
			icon: PiAppWindowFill,
			title: t('app-settings-list.title'),
			description: t('app-settings-list.description'),
			to: '/settings/apps',
			keywords: [t('app-settings.storage.title'), t('app-settings.advanced.title'), t('app-settings.auth.row-title')],
		},
		{
			kind: 'page',
			id: 'migration',
			category: 'storage',
			command: {},
			icon: suppliedSettingsIcons.migrationAssistant,
			title: t('migration-assistant'),
			description: t('migration-assistant-description', {deviceName}),
			to: '/settings/migration-assistant',
			keywords: [
				t('migration-assistant.prep.body'),
				t('migration-assistant.prep.shut-down-rpi'),
				t('migration-assistant.prep.connect-disk-to-home'),
				t('migration-assistant.ready.description'),
				t('migration-assistant.ready.hint-keep-pi-off.title'),
				t('migration-assistant.ready.hint-use-same-password.title'),
				t('migration-assistant.ready.hint-use-same-password.description'),
			],
		},
		{
			kind: 'page',
			id: 'device-info',
			category: 'system',
			command: {},
			icon: suppliedSettingsIcons.deviceInfo,
			title: t('device-info'),
			description: t('device-info-description'),
			to: '/settings/device-info',
			keywords: [
				t('device-info.device'),
				t('device-info.model-number'),
				t('device-info.serial-number'),
				t('device-info.cpu'),
				t('device-info.gpu'),
				t('device-info.memory'),
				t('device-info.storage'),
			],
		},
		{
			kind: 'page',
			id: 'mcp',
			category: 'system',
			command: {},
			icon: TbSparkles,
			title: t('mcp'),
			description: t('mcp-description'),
			to: '/settings/mcp',
			keywords: [
				'mcp',
				t('mcp-agents'),
				t('mcp-permissions'),
				t('mcp-apps'),
				t('mcp-folders'),
				t('mcp-app-store'),
				t('mcp-manage-system'),
			],
		},
		{
			kind: 'page',
			id: 'file-sharing',
			category: 'storage',
			command: {},
			icon: PiShareNetworkFill,
			title: t('settings.file-sharing'),
			description: t('settings.file-sharing.description'),
			to: '/settings/file-sharing',
			keywords: [
				'smb',
				'windows',
				'macos',
				'ios',
				'android',
				t('settings.file-sharing.choice-subtitle'),
				t('settings.file-sharing.choice-heading'),
				t('settings.file-sharing.choice-entire-title'),
				t('settings.file-sharing.choice-entire-description'),
				t('settings.file-sharing.choice-specific-title'),
				t('settings.file-sharing.choice-specific-description'),
				t('settings.file-sharing.share-entire-home-dir'),
				t('settings.file-sharing.share-entire-home-dir-description'),
				t('settings.file-sharing.shared-folders'),
				t('settings.file-sharing.add-folder-title'),
			],
		},
		{
			kind: 'page',
			id: 'backups',
			category: 'storage',
			command: {default: true, target: {type: 'backups'}},
			icon: PiClockCounterClockwiseFill,
			title: t('backups'),
			description: t('backups-description'),
			to: '/settings/backups',
			keywords: [
				t('backups-setup'),
				t('backups-configure'),
				t('backups-configure.add-backup-location'),
				t('backups-setup-nas-or-umbrel-description'),
				t('backups-setup-external-description'),
				t('backups.select-backup-location'),
				t('backups.exclude-from-backups'),
				t('backups.exclude-from-backups-description'),
				t('backups.set-encryption-password'),
				t('backups.set-encryption-password-description'),
				t('backups-restore'),
				t('backups-restore-full-description'),
				t('backups-rewind'),
				t('backups-rewind-description'),
			],
		},
		{
			kind: 'page',
			id: 'advanced',
			category: 'system',
			command: {},
			icon: IoIosSettings,
			title: t('advanced-settings'),
			description: t('advanced-settings-description'),
			to: '/settings/advanced',
			keywords: [
				'https',
				'http',
				'dhcp',
				t('terminal'),
				t('terminal-description'),
				t('beta-program'),
				t('beta-program-description'),
				t('network'),
				t('network-description'),
				t('network.hostname'),
				t('network.interfaces'),
				t('network.device-ip'),
				t('network.detail-mac'),
				t('network.ipv4'),
				t('network.ipv4-automatic'),
				t('network.ipv4-automatic-description'),
				t('network.ipv4-static'),
				t('network.ipv4-static-description'),
				t('network.ipv4-address'),
				t('network.ipv4-gateway'),
				t('network.ipv4-subnet'),
				t('network.dns'),
				t('network.dns-router'),
				t('network.dns-router-description'),
				t('network.dns-cloudflare'),
				t('network.dns-cloudflare-description'),
				t('https-access-network-title'),
				t('https-access-description'),
				t('https-access-private-access-note'),
				t('https-access-view-instructions'),
				t('https-access-certificate-settings-title'),
				t('https-access-certificate-settings-description'),
				t('https-access-download-certificate'),
				'thunderbolt',
				'egpu',
				'gpu',
				t('thunderbolt-settings.title'),
				t('thunderbolt-settings.description'),
				t('remote-tor-access'),
				t('tor-description'),
				t('tor-enabled-description'),
				t('factory-reset'),
				t('factory-reset-description'),
			],
		},
		{
			kind: 'page',
			id: 'software-update',
			category: 'system',
			command: {},
			icon: PiArrowCircleUpFill,
			title: t('software-update.title'),
			description: t('check-for-latest-version'),
			to: '/settings/software-update',
			keywords: [
				t('software-update.check'),
				t('software-update.checking'),
				t('software-update.current-running'),
				t('software-update.new-version'),
				t('software-update.install-now'),
				t('software-update.on-latest'),
			],
		},
		{
			kind: 'page',
			id: 'troubleshoot',
			category: 'troubleshoot',
			command: {target: {type: 'current-location-dialog', dialog: 'troubleshoot'}},
			icon: PiWrenchFill,
			title: t('troubleshoot'),
			description: t('troubleshoot-description'),
			to: '/settings?dialog=troubleshoot',
			keywords: [
				t('troubleshoot-pick-title'),
				t('umbrelos'),
				t('troubleshoot.umbrelos-description'),
				t('troubleshoot.umbrelos-logs'),
				t('troubleshoot.system-download'),
				t('troubleshoot.app'),
				t('troubleshoot.app-description'),
				t('troubleshoot.app-download'),
				t('troubleshoot.share-with-umbrel-support'),
			],
		},
		{
			kind: 'page',
			id: 'support',
			category: 'troubleshoot',
			command: {},
			external: true,
			icon: BsFillQuestionCircleFill,
			title: t('onboarding.contact-support'),
			description: t('settings.contact-support'),
			to: links.support,
		},
	]

	const memberPageItems: SettingsPageItem[] = [
		{
			kind: 'page',
			id: 'change-name',
			category: 'account',
			icon: suppliedSettingsIcons.account,
			title: t('change-name'),
			description: memberName ?? t('account-description'),
			to: '/settings/account/change-name',
			keywords: [t('account'), t('change-name.input-placeholder')],
		},
		{
			kind: 'page',
			id: 'change-password',
			category: 'account',
			icon: PiKeyFill,
			title: t('change-password'),
			description: t('change-password.description'),
			to: '/settings/account/change-password',
			keywords: [
				t('account'),
				t('change-password.current-password'),
				t('change-password.new-password'),
				t('change-password.repeat-password'),
				t('change-password.callout'),
			],
		},
		{
			kind: 'page',
			id: '2fa',
			category: 'account',
			icon: FaShield,
			title: t('2fa'),
			description: t('2fa-description'),
			to: '/settings/2fa',
			keywords: [t('2fa.enable.title'), t('2fa.disable.title'), t('2fa.enter-code')],
		},
		{
			kind: 'page',
			id: 'sessions',
			category: 'account',
			icon: PiDevicesFill,
			title: t('active-logins.title'),
			description: t('active-logins.description'),
			to: '/settings/sessions',
			keywords: [
				'session',
				'sessions',
				t('active-logins.current'),
				t('active-logins.logged-in'),
				t('active-logins.last-active-ago'),
				t('active-logins.logout'),
			],
		},
	]

	const commandOnlyItems: SettingsCommandItem[] = [
		{
			kind: 'command',
			id: 'account',
			target: {
				type: 'navigate',
				to: isMember ? '/settings/account/change-name' : '/settings/users?ownerPanel=overview',
			},
			title: t('account'),
			description: t('account-description'),
			keywords: ['session', 'sessions', t('change-name'), t('change-password'), t('active-logins.title'), t('2fa')],
		},
		{
			kind: 'command',
			id: 'sessions',
			target: {
				type: 'navigate',
				to: isMember ? '/settings/sessions' : '/settings/users?ownerPanel=sessions',
			},
			title: t('active-logins.title'),
			description: t('active-logins.description'),
			keywords: [
				'session',
				'sessions',
				t('active-logins.current'),
				t('active-logins.logged-in'),
				t('active-logins.last-active-ago'),
				t('active-logins.unknown-device'),
				t('active-logins.logout'),
				t('active-logins.logout-other-devices'),
				t('active-logins.logout-everywhere'),
				t('active-logins.empty'),
			],
		},
		{
			kind: 'command',
			id: '2fa',
			target: {type: 'navigate', to: '/settings/2fa'},
			title: t('2fa'),
			description: t('2fa-description'),
			keywords: [
				t('2fa.enable.title'),
				t('2fa.disable.title'),
				t('2fa.enable.scan-this'),
				t('2fa.enable.or-paste'),
				t('2fa.enter-code'),
			],
		},
		{
			kind: 'command',
			id: 'change-name',
			target: {
				type: 'navigate',
				to: isMember ? '/settings/account/change-name' : '/settings/users?ownerPanel=name',
			},
			title: t('change-name'),
			description: t('account'),
			keywords: [t('account-description'), t('change-name.input-placeholder')],
		},
		{
			kind: 'command',
			id: 'change-password',
			target: {
				type: 'navigate',
				to: isMember ? '/settings/account/change-password' : '/settings/users?ownerPanel=password',
			},
			title: t('change-password'),
			description: t('change-password.description'),
			keywords: [
				t('account-description'),
				t('change-password.current-password'),
				t('change-password.new-password'),
				t('change-password.repeat-password'),
				t('change-password.callout'),
			],
		},
		{
			kind: 'command',
			id: 'logout',
			target: {type: 'current-location-dialog', dialog: 'logout'},
			title: t('logout'),
		},
		{
			kind: 'command',
			id: 'restart',
			default: true,
			target: {type: 'navigate', to: '/settings?dialog=restart'},
			title: t('cmdk.restart-umbrel'),
		},
		{
			kind: 'command',
			id: 'shutdown',
			target: {type: 'navigate', to: '/settings?dialog=shutdown'},
			title: t('cmdk.shutdown-umbrel'),
		},
		{
			kind: 'command',
			id: 'remote-tor-access',
			target: {type: 'navigate', to: '/settings/advanced/tor'},
			title: t('remote-tor-access'),
			description: t('tor-description'),
			keywords: [t('tor-enabled-description'), t('tor.hidden-service')],
		},
		{
			kind: 'command',
			id: 'terminal',
			target: {type: 'current-location-dialog', dialog: 'terminal'},
			title: t('terminal'),
			description: t('terminal-description'),
		},
		{
			kind: 'command',
			id: 'factory-reset',
			target: {type: 'navigate', to: '/factory-reset'},
			title: t('factory-reset'),
			description: t('factory-reset-description'),
		},
		{
			kind: 'command',
			id: 'beta-program',
			target: {type: 'navigate', to: '/settings/advanced/beta-program'},
			title: t('beta-program'),
			description: t('beta-program-description'),
		},
		{
			kind: 'command',
			id: 'network',
			target: {type: 'navigate', to: '/settings/advanced/network'},
			title: t('network'),
			description: t('network-description'),
			keywords: ['dhcp', t('network.hostname'), t('network.device-ip'), t('network.ipv4'), t('network.dns')],
		},
		{
			kind: 'command',
			id: 'https-access',
			target: {type: 'navigate', to: '/settings/advanced/network?httpsAccess=guide'},
			title: t('https-access-network-title'),
			description: t('https-access-description'),
			keywords: ['https', t('https-access-view-instructions'), t('https-access-certificate-settings-title')],
		},
		{
			kind: 'command',
			id: 'external-dns',
			target: {type: 'navigate', to: '/settings/advanced/network'},
			title: t('external-dns'),
			description: t('network.dns-cloudflare-description'),
			keywords: [t('network.dns'), t('network.dns-router'), t('network.dns-router-description')],
		},
		{
			kind: 'command',
			id: 'backups-restore',
			target: {type: 'navigate', to: '/settings/backups/restore'},
			title: t('backups-restore'),
			description: t('backups-restore-full-description'),
		},
		{
			kind: 'command',
			id: 'backups-rewind',
			target: {type: 'navigate', to: '/files/Home?rewind=open'},
			title: t('backups-rewind'),
			description: t('backups-rewind-description'),
		},
	]

	const memberPreferenceItems = pageItems.filter(({id}) => id === 'wallpaper' || id === 'widgets' || id === 'language')
	// Members get the File sharing row in their single account section, right below Widgets
	const memberFileSharingItems = sambaEnabled
		? pageItems
				.filter(({id}) => id === 'file-sharing')
				.map((item) => ({
					...item,
					category: 'account' as const,
					order: (settingsPageItemOrder.get('widgets') ?? 0) + 0.5,
				}))
		: []
	const visiblePageItems = isMember
		? [...memberPageItems, ...memberPreferenceItems, ...memberFileSharingItems]
		: pageItems
	const memberCommandIds = new Set<SettingsItemId>([
		'account',
		'sessions',
		'2fa',
		'change-name',
		'change-password',
		'logout',
	])
	const visibleCommandItems = isMember ? commandOnlyItems.filter(({id}) => memberCommandIds.has(id)) : commandOnlyItems

	return [...visiblePageItems, ...visibleCommandItems]
}

export function getSettingsPage(
	catalog: SettingsCatalogItem[],
	{query = '', filter = 'all'}: {query?: string; filter?: SettingsFilterId} = {},
): SettingsPage {
	const pageItems = catalog
		.filter((item): item is SettingsPageItem => item.kind === 'page')
		.sort(
			(a, b) =>
				(a.order ?? settingsPageItemOrder.get(a.id) ?? Number.POSITIVE_INFINITY) -
				(b.order ?? settingsPageItemOrder.get(b.id) ?? Number.POSITIVE_INFINITY),
		)
	const items = query.trim()
		? searchSettingsItems(pageItems, query)
		: filter === 'all'
			? pageItems
			: pageItems.filter((item) => item.category === filter)
	const itemsByCategory: Record<SettingsCategoryId, SettingsPageItem[]> = {
		account: [],
		storage: [],
		system: [],
		troubleshoot: [],
	}

	for (const item of items) itemsByCategory[item.category].push(item)

	return {
		items,
		itemsByCategory,
		categoryIds: SETTINGS_CATEGORY_IDS.filter((categoryId) => itemsByCategory[categoryId].length > 0),
	}
}

export function getSettingsCommandItems(catalog: SettingsCatalogItem[]): SettingsCommandCatalogItem[] {
	return catalog.filter(isSettingsCommandItem)
}

export function getDefaultSettingsCommandItems(catalog: SettingsCatalogItem[]): SettingsCommandCatalogItem[] {
	return catalog
		.filter(isSettingsCommandItem)
		.filter((item) => (item.kind === 'command' ? item.default : item.command.default))
}

export function getSettingsCommandTarget(item: SettingsCommandCatalogItem): SettingsCommandTarget {
	if (item.kind === 'command') return item.target
	if (item.command.target) return item.command.target
	return item.external ? {type: 'external', to: item.to} : {type: 'navigate', to: item.to}
}

export function searchSettingsItems<T extends SettingsCatalogItem>(items: T[], query: string): T[] {
	const normalizedQuery = normalizeSearchText(query)
	if (!normalizedQuery) return items

	const matches = new Set(
		matchSorter(items, normalizedQuery, {
			keys: [(item) => settingsItemSearchValues(item).map(normalizeSearchText)],
		}),
	)
	return items.filter((item) => matches.has(item))
}

function settingsItemSearchValues(item: SettingsCatalogItem) {
	return [item.title, item.description, ...(item.keywords ?? [])].filter((value): value is string => Boolean(value))
}

function isSettingsCommandItem(item: SettingsCatalogItem): item is SettingsCommandCatalogItem {
	return item.kind === 'command' || item.command !== undefined
}
