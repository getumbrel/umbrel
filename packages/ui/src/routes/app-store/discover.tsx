import {useAvailableApps} from '@/hooks/use-available-apps'
import {AppStoreNav} from '@/modules/app-store/app-store-nav'
import {Apps3UpSection} from '@/modules/app-store/discover/apps-3-up-section'
import {AppsGridSection} from '@/modules/app-store/discover/apps-grid-section'
import {AppsRowSection} from '@/modules/app-store/discover/apps-row-section'
import {AppsGallerySection} from '@/modules/app-store/gallery-section'
import {Button} from '@/shadcn-components/ui/button'

export function Discover() {
	const {isLoading, apps, appsKeyed} = useAvailableApps()

	if (isLoading) {
		return <p>Loading...</p>
	}

	return (
		<>
			<AppStoreNav />
			<AppsGallerySection apps={apps.slice(0, 5)} />
			<AppsGridSection overline='Most installs' title='By popular demand' apps={apps.slice(0, 9)} />
			<AppsRowSection overline='Staff picks' title='Curated for you' apps={apps.slice(0, 5)} />
			<AppsGridSection overline='Recently published' title='Fresh from the oven' apps={apps.slice(0, 9)} />
			<Apps3UpSection
				apps={[appsKeyed['bitcoin'], appsKeyed['lightning'], appsKeyed['electrs']]}
				overline='Bitcoin'
				title='Node of your own, an ode to autonomy.'
				description='In this decentralized era, running your personal node is a breeze. Run your node, power the new internet, and take the blockchain by the blocks.'
			>
				<Button variant='secondary' size='dialog'>
					Browse Bitcoin apps
				</Button>
			</Apps3UpSection>
			<AppsGridSection overline='Must haves' title='Essentials for your Umbrel' apps={apps.slice(0, 9)} />
			<Apps3UpSection
				apps={[appsKeyed['immich'], appsKeyed['nextcloud'], appsKeyed['photoprism']]}
				overline='Files & productivity'
				title='Bytes in the right place.'
				description='The best place for all your photos, files, and movies is your place. 
				Browse apps that lets you truly own & self-host your data.'
				textLocation='right'
			>
				<Button variant='secondary' size='dialog'>
					Browse productivity apps
				</Button>
			</Apps3UpSection>
			<AppsGridSection overline='Under the radar' title='Hidden gems' apps={apps.slice(0, 9)} />
			<Apps3UpSection
				apps={[appsKeyed['jellyfin'], appsKeyed['plex'], appsKeyed['sonarr']]}
				overline='Bitcoin'
				title='Node of your own, an ode to autonomy.'
				description='In this decentralized era, running your personal node is a breeze. Run your node, power the new internet, and take the blockchain by the blocks.'
			>
				<Button variant='secondary' size='dialog'>
					Browse Bitcoin apps
				</Button>
			</Apps3UpSection>
		</>
	)
}
