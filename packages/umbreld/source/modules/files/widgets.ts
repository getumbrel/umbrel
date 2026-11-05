import type Umbreld from '../../index.ts'

export const filesWidgets = {
	'files-recents': async function (umbreld: Umbreld, accountId: string) {
		const recentFiles = await umbreld.files.recents.get(accountId)

		return {
			type: 'files-list',
			link: '/files/Recents',
			refresh: '5s',
			items: recentFiles.slice(0, 3),
			noItemsText: 'files-widgets.recents.no-items-text',
		}
	},

	'files-favorites': async function (umbreld: Umbreld, accountId: string) {
		const favorites = await umbreld.files.favorites.listFavorites(accountId)

		return {
			type: 'files-grid',
			refresh: '30s',
			paths: favorites.slice(0, 4),
			noItemsText: 'files-widgets.favorites.no-items-text',
		}
	},
} as const
