import {AppsProvider} from '@/hooks/use-apps'
import {AvailableAppsProvider} from '@/hooks/use-available-apps'

// TODO: this view should just be in '/'
// TODO: put providers in router file
export default function InstallFirstApp() {
	return (
		<AvailableAppsProvider>
			<AppsProvider>
				<InstallFirstApp />
			</AppsProvider>
		</AvailableAppsProvider>
	)
}
