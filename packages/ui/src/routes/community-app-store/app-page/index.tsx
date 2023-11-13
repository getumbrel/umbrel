import {useState} from 'react'
import {useParams} from 'react-router-dom'
import {toast} from 'sonner'

import {Loading} from '@/components/ui/loading'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {AppContent} from '@/modules/app-store/app-page/app-content'
import {appPageWrapperClass} from '@/modules/app-store/app-page/shared'
import {TopHeader} from '@/modules/app-store/app-page/top-header'
import {CommunityBadge} from '@/modules/community-app-store/community-badge'
import {Button} from '@/shadcn-components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@/shadcn-components/ui/dialog'
import {trpcReact} from '@/trpc/trpc'
import {portToUrl} from '@/utils/misc'
import {trackAppOpen} from '@/utils/track-app-open'

export function CommunityAppPage() {
	const {appStoreId, appId} = useParams<{appStoreId: string; appId: string}>()

	const registryQ = trpcReact.appStore.registry.useQuery()
	const appStore = registryQ.data?.find((appStore) => appStore?.meta.id === appStoreId)

	const app = appStore?.apps.find((app) => app.id === appId)

	useUmbrelTitle(app?.name || 'Unknown App')

	if (registryQ.isLoading) return <Loading />
	if (!app) return <div>App not found</div>

	return (
		<div className={appPageWrapperClass}>
			<CommunityBadge className='self-start' />
			<TopHeader app={app} childrenRight={<InstallButton appName={app.name} appId={app.id} port={app.port} />} />
			<AppContent app={app} />
		</div>
	)
}

function InstallButton({appName, appId, port}: {appName: string; appId: string; port: number}) {
	const [open, setOpen] = useState(false)

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button size='lg' variant='primary'>
					Install
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Are you absolutely sure?</DialogTitle>
					<DialogDescription>
						<b>{appName}</b> is an app published in a Community App Store. These apps are not verified or vetted by the
						official Umbrel App Store team, and can potentially be insecure or malicious.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button size='dialog' variant='secondary' onClick={() => setOpen(false)}>
						Cancel
					</Button>
					<Button
						size='dialog'
						variant='destructive'
						onClick={() => {
							toast('Installing...')
							setTimeout(() => {
								toast.success('Installed!', {
									action: {
										label: 'Open',
										onClick: () => {
											trackAppOpen(appId)
											window.open(portToUrl(port), '_blank')
										},
									},
								})
							}, 3000)
							setOpen(false)
						}}
					>
						Continue
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
