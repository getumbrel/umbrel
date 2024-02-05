import {useNavigate} from 'react-router-dom'
import urlJoin from 'url-join'

import {UserApp} from '@/trpc/trpc'
import {useLinkToDialog} from '@/utils/dialog'
import {appToUrl, isOnionPage} from '@/utils/misc'
import {trackAppOpen} from '@/utils/track-app-open'

import {useApps} from './use-apps'

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
 * - Want to track app opens. If we only return a href, it's too easy to forget to track app opens.
 * - Want to show a dialog if the app has default credentials.
 * - API like `useLaunchApp(appId)` won't work because we want to sometimes loop through multiple apps and add an `onClick`to each one.
 * - If an app has been uninstalled, but the UI still shows it (maybe because some queries haven't been invalidated), we want to let the user know they can't open the app because it's be uninstalled?
 */
export function useLaunchApp() {
	const userApp = useApps()
	const navigate = useNavigate()
	const linkToDialog = useLinkToDialog()

	const handleLaunch = (appId: string, options?: {path?: string; direct?: boolean}) => {
		const app = userApp.userAppsKeyed?.[appId]

		if (!app) {
			// return linkToDialog('app-not-found', {id: appId})
			throw new Error(`App not found: ${appId}`)
		}

		// If we're already in the credentials dialog, don't show the dialog again.
		if (app.showCredentialsBeforeOpen && !options?.direct) {
			navigate(linkToDialog('default-credentials', {for: appId, direct: 'true'}))
		} else {
			if (app.torOnly) {
				if (isOnionPage()) {
					openApp(app, options?.path)
				} else {
					// return linkToDialog('tor-error', {id: appId})
					alert(
						`${app.name} can only be used over Tor. Please access your Umbrel in a Tor browser on your remote access URL (Settings > Account > Remote access) to open this app.`,
					)
				}
			} else {
				openApp(app, options?.path)
			}
		}
	}

	return handleLaunch
}

function openApp(app: UserApp, path?: string) {
	trackAppOpen(app.id)
	const url = path ? urlJoin(appToUrl(app), path) : appToUrl(app)
	window.open(url, '_blank')?.focus()
}
