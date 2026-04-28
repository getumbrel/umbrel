import z from 'zod'

import {router, privateProcedure} from '../server/trpc/trpc.js'
import {fetchPageMetadata} from './fetch-page-metadata.js'

function toFetchableUrl(url: string): string {
	return url.startsWith('umbrel:') ? `${url.replace('umbrel:', 'http://localhost:')}` : url
}

export default router({
	// Fetch metadata (title + icon URL) from a URL
	fetchPageMetadata: privateProcedure.input(z.object({url: z.string().min(1)})).query(async ({input}) => {
		if (input.url.endsWith('/')) input.url = input.url.slice(0, -1)
		return fetchPageMetadata(toFetchableUrl(input.url))
	}),

	// List all shortcuts
	list: privateProcedure.query(async ({ctx}) => {
		const shortcuts = (await ctx.umbreld.store.get('shortcuts')) || []
		return shortcuts
	}),

	// Add a new shortcut
	add: privateProcedure
		.input(
			z.object({
				url: z.string().min(1),
				title: z.string().min(1).max(200),
				icon: z.string().optional(),
			}),
		)
		.mutation(async ({ctx, input}) => {
			if (input.url.endsWith('/')) input.url = input.url.slice(0, -1)

			// Validate URL by converting umbrel: prefix to http://localhost:
			z.string().url().parse(toFetchableUrl(input.url))

			await ctx.umbreld.store.getWriteLock(async ({get, set}) => {
				const shortcuts = (await get('shortcuts')) || []

				// Check if the shortcut already exists
				if (shortcuts.some((s) => s.url === input.url)) throw new Error('[shortcut-already-exists]')

				shortcuts.push(input)
				await set('shortcuts', shortcuts)
			})

			return true
		}),

	// Remove a shortcut
	remove: privateProcedure.input(z.object({url: z.string()})).mutation(async ({ctx, input}) => {
		await ctx.umbreld.store.getWriteLock(async ({get, set}) => {
			const shortcuts = (await get('shortcuts')) || []

			// Check if the shortcut exists
			if (!shortcuts.find((shortcut) => shortcut.url === input.url)) throw new Error('[shortcut-not-found]')

			// Remove the shortcut
			const updatedShortcuts = shortcuts.filter((shortcut) => shortcut.url !== input.url)
			await set('shortcuts', updatedShortcuts)
		})

		return true
	}),
})
