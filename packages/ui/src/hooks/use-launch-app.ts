import {useTranslation} from 'react-i18next'
import {useNavigate} from 'react-router-dom'

import {toast} from '@/components/ui/toast'
import {useApps} from '@/providers/apps'
import {trpcReact} from '@/trpc/trpc'
import {useLinkToDialog} from '@/utils/dialog'
import {appToUrl, appToUrlWithAppPath, getAlwaysOpenHttpsRequiredApps, isOnionPage, urlJoin} from '@/utils/misc'

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
	const {t} = useTranslation()
	const userApp = useApps()
	const navigate = useNavigate()
	const linkToDialog = useLinkToDialog()
	const utils = trpcReact.useUtils()
	const trackOpenMut = trpcReact.apps.trackOpen.useMutation({
		onSuccess() {
			utils.apps.recentlyOpened.invalidate()
		},
	})
	// Open tracking is owner-only (it powers the owner's cmd-k suggestions)
	const userQ = trpcReact.user.get.useQuery()
	const isMember = userQ.data?.role === 'member'

	const handleLaunch = (appId: string, options?: {path?: string; direct?: boolean; protocol?: 'http:' | 'https:'}) => {
		const app = userApp.userAppsKeyed?.[appId]

		if (!app) {
			// return linkToDialog('app-not-found', {id: appId})
			throw new Error(t('app-not-found', {app: appId}))
		}

		const open = (path?: string, protocol = location.protocol) => {
			if (!isMember) trackOpenMut.mutate({appId})
			const url = path ? urlJoin(appToUrl(app, protocol), path) : appToUrlWithAppPath(app, protocol)
			window.open(url, '_blank')?.focus()
		}

		if (app.torOnly && !isOnionPage()) {
			toast.warning(t('app-only-over-tor', {app: app.name}), {area: 'app-store'})
			return
		}

		const needsHttps = app.requiresHttps && !isOnionPage() && window.location.protocol !== 'https:'
		const protocol = needsHttps ? 'https:' : options?.protocol
		const showCredentials = app.credentials?.showBeforeOpen && !options?.direct
		const showHttps = needsHttps && options?.protocol !== 'https:' && !getAlwaysOpenHttpsRequiredApps()

		if (showCredentials || showHttps) {
			navigate(
				linkToDialog('app-launch', {
					for: appId,
					...(showCredentials ? {credentials: 'true'} : {}),
					...(showHttps ? {https: 'true'} : {}),
					...(options?.path ? {path: options.path} : {}),
					...(protocol ? {protocol} : {}),
				}),
			)
		} else {
			open(options?.path, protocol)
		}
	}

	return handleLaunch
}
