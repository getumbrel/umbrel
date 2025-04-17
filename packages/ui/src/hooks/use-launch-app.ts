import {useNavigate} from 'react-router-dom'

import {useApps} from '@/providers/apps'
import {trpcReact} from '@/trpc/trpc'
import {useLinkToDialog} from '@/utils/dialog'
import {t} from '@/utils/i18n'
import {appToUrl, appToUrlWithAppPath, isOnionPage, urlJoin} from '@/utils/misc'

/**
 * There's a strong temptation to make launching an app just a link to the app's URL:
 * - You get a url on mouse hover.
 * - You can right click and copy the link.
 * - You can cmd-click on a page to open it in a new tab.
 * - It's easy to append a path to the URL. If we just return a string, this would make appending paths way easier.
 * - It's more semantic.
 *
 * However, it's not worth the complexity on the consumer right now.
 *
 * The main reason to switch back to hrefs would be because we don't actually want to open in new tabs by default, and if we can find a better way to track app opens.
 *
 * Trying to satisfy multiple considerations here:
 * - Consumer API should be simple. We don't want the consumer to have to deal with the "how" of openining an app, only the intent. You want to open an app? Just tell us which app and we'll handle the rest.
 * - Not returning a href because then how do we open in a blank page? The consumer of this hook would have to deal with the logic of this.
 * - Want to track app opens to compute frequent apps for CMD K. If we only return a href, it's too easy to forget to track app opens.
 * - Want to show a dialog if the app has default credentials.
 * - API like `useLaunchApp(appId)` won't work because we want to sometimes loop through multiple apps and add an `onClick`to each one.
 * - If an app has been uninstalled, but the UI still shows it (maybe because some queries haven't been invalidated), we want to let the user know they can't open the app because it's be uninstalled?
 */
export function useLaunchApp() {
	const userApp = useApps()
	const navigate = useNavigate()
	const linkToDialog = useLinkToDialog()
	const utils = trpcReact.useUtils()
	const trackOpenMut = trpcReact.apps.trackOpen.useMutation({
		onSuccess() {
			utils.apps.recentlyOpened.invalidate()
		},
	})

	const handleLaunch = (appId: string, options?: {path?: string; direct?: boolean}) => {
		const app = userApp.userAppsKeyed?.[appId]

		if (!app) {
			// return linkToDialog('app-not-found', {id: appId})
			throw new Error(t('app-not-found', {app: appId}))
		}

		const open = (path?: string) => {
			trackOpenMut.mutate({appId})
			const url = path ? urlJoin(appToUrl(app), path) : appToUrlWithAppPath(app)
			window.open(url, '_blank')?.focus()
		}

		// If we're already in the credentials dialog, don't show the dialog again.
		if (app.credentials?.showBeforeOpen && !options?.direct) {
			navigate(linkToDialog('default-credentials', {for: appId, direct: 'true'}))
		} else {
			if (app.torOnly) {
				if (isOnionPage()) {
					open(options?.path)
				} else {
					// return linkToDialog('tor-error', {id: appId})
					alert(t('app-only-over-tor', {app: app.name}))
				}
			} else {
				open(options?.path)
			}
		}
	}

	return handleLaunch
}
