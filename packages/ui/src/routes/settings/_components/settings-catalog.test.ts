import {TFunction} from 'i18next'
import {describe, expect, it} from 'vitest'

import {
	createSettingsCatalog,
	getDefaultSettingsCommandItems,
	getSettingsCommandItems,
	getSettingsCommandTarget,
	getSettingsPage,
} from './settings-catalog'

const t = ((key: string) => (key === 'backups-description' ? 'Back up your files, apps, and data' : key)) as TFunction

function catalog(translator = t) {
	return createSettingsCatalog(translator, {deviceName: 'Umbrel Home'})
}

describe('settings catalog search', () => {
	it('indexes nested copy under its top-level rows', () => {
		for (const query of ['sessions', 'change-password', '2fa']) {
			expect(getSettingsPage(catalog(), {query}).items.map(({id}) => id)).toContain('users')
		}

		expect(getSettingsPage(catalog(), {query: 'https'}).items.map(({id}) => id)).toContain('advanced')
		expect(getSettingsCommandItems(catalog()).map(({id}) => id)).toContain('https-access')
	})

	it('derives mounted categories from matching rows', () => {
		const page = getSettingsPage(catalog(), {query: 'wifi'})

		expect(page.categoryIds).toEqual(['system'])
		expect(page.items).not.toHaveLength(0)
		expect(page.items.every(({category}) => category === 'system')).toBe(true)
	})

	it('places MCP in the owner System section and command search', () => {
		const ownerCatalog = catalog()
		const systemPage = getSettingsPage(ownerCatalog, {filter: 'system'})

		expect(systemPage.items.map(({id}) => id)).toContain('mcp')
		expect(getSettingsCommandItems(ownerCatalog).map(({id}) => id)).toContain('mcp')

		const memberCatalog = createSettingsCatalog(t, {deviceName: 'Umbrel Home', isMember: true})
		expect(getSettingsPage(memberCatalog).items.map(({id}) => id)).not.toContain('mcp')
		expect(getSettingsCommandItems(memberCatalog).map(({id}) => id)).not.toContain('mcp')
	})

	it('places app settings in the owner Storage section and command search', () => {
		const ownerCatalog = catalog()
		expect(getSettingsPage(ownerCatalog, {filter: 'storage'}).items.map(({id}) => id)).toContain('apps')
		expect(getSettingsCommandItems(ownerCatalog).map(({id}) => id)).toContain('apps')

		const memberCatalog = createSettingsCatalog(t, {deviceName: 'Umbrel Home', isMember: true})
		expect(getSettingsPage(memberCatalog).items.map(({id}) => id)).not.toContain('apps')
		expect(getSettingsCommandItems(memberCatalog).map(({id}) => id)).not.toContain('apps')
	})

	it('matches accentless queries against translated copy', () => {
		const localizedT = ((key: string) => (key === 'network.hostname' ? 'Nom d’hôte sécurisé' : key)) as TFunction
		const localizedCatalog = catalog(localizedT)

		expect(getSettingsPage(localizedCatalog, {query: 'hote securise'}).items.map(({id}) => id)).toContain('advanced')
	})

	it('resolves page command targets from the page destination when no override exists', () => {
		const commandItems = getSettingsCommandItems(catalog())
		const wallpaper = commandItems.find(({id}) => id === 'wallpaper')!
		const support = commandItems.find(({id}) => id === 'support')!
		const backups = commandItems.find(({id}) => id === 'backups')!

		expect(wallpaper.kind).toBe('page')
		expect(support.kind).toBe('page')
		if (wallpaper.kind !== 'page' || support.kind !== 'page') throw new Error('Expected page command items')
		expect(getSettingsCommandTarget(wallpaper)).toEqual({type: 'navigate', to: wallpaper.to})
		expect(getSettingsCommandTarget(support)).toEqual({type: 'external', to: support.to})
		expect(getSettingsCommandTarget(backups)).toEqual({type: 'backups'})
	})

	it('keeps the established zero-query actions', () => {
		expect(getDefaultSettingsCommandItems(catalog()).map(({id}) => id)).toEqual([
			'wallpaper',
			'widgets',
			'backups',
			'restart',
		])
	})

	it('places widgets directly below wallpaper for owners and members', () => {
		for (const settingsCatalog of [catalog(), createSettingsCatalog(t, {deviceName: 'Umbrel Home', isMember: true})]) {
			const accountIds = getSettingsPage(settingsCatalog, {filter: 'account'}).items.map(({id}) => id)
			const wallpaperIndex = accountIds.indexOf('wallpaper')
			const widgets = getSettingsPage(settingsCatalog).items.find(({id}) => id === 'widgets')

			expect(wallpaperIndex).toBeGreaterThanOrEqual(0)
			expect(accountIds[wallpaperIndex + 1]).toBe('widgets')
			expect(widgets?.description).toBe('widgets.description')
		}
	})

	it('gates owner-only settings for members', () => {
		const memberCatalog = createSettingsCatalog(t, {
			deviceName: 'Umbrel Home',
			isMember: true,
			memberName: 'Alice Member',
		})
		const page = getSettingsPage(memberCatalog)
		const pageIds = page.items.map(({id}) => id)
		const commandItems = getSettingsCommandItems(memberCatalog)
		const commandIds = commandItems.map(({id}) => id)
		const accountCommand = commandItems.find(({id}) => id === 'account')!

		expect(page.items).not.toHaveLength(0)
		expect(page.items.every(({category}) => category === 'account')).toBe(true)
		expect(page.items.find(({id}) => id === 'change-name')?.description).toBe('Alice Member')
		expect(pageIds).toEqual(
			expect.arrayContaining([
				'change-name',
				'change-password',
				'2fa',
				'sessions',
				'wallpaper',
				'widgets',
				'language',
				'accessibility',
			]),
		)
		expect(pageIds).not.toContain('avatar')
		expect(getSettingsCommandTarget(accountCommand)).toEqual({
			type: 'navigate',
			to: '/settings/account/change-name',
		})
		expect(commandIds).not.toContain('advanced')
		expect(commandIds).not.toContain('restart')
		expect(commandIds).toContain('change-password')
		expect(commandIds).toContain('language')
	})

	it('filters by category without changing row categories', () => {
		for (const filter of ['storage', 'system'] as const) {
			const page = getSettingsPage(catalog(), {filter})

			expect(page.categoryIds).toEqual([filter])
			expect(page.items).not.toHaveLength(0)
			expect(page.items.every(({category}) => category === filter)).toBe(true)
		}
	})

	it('searches the full catalog independently of the selected filter', () => {
		const results = getSettingsPage(catalog(), {filter: 'account', query: 'https'})

		expect(results.items.map(({id}) => id)).toContain('advanced')
		expect(getSettingsPage(catalog(), {filter: 'account'}).items.every(({category}) => category === 'account')).toBe(
			true,
		)
	})
})
