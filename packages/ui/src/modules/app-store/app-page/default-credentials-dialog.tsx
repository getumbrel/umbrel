import {useId} from 'react'

import {CopyableField} from '@/components/ui/copyable-field'
import {UmbrelHeadTitle} from '@/components/umbrel-head-title'
import {useUserApp} from '@/hooks/use-apps'
import {useLaunchApp} from '@/hooks/use-launch-app'
import {useQueryParams} from '@/hooks/use-query-params'
import {Button} from '@/shadcn-components/ui/button'
import {Checkbox, checkboxContainerClass, checkboxLabelClass} from '@/shadcn-components/ui/checkbox'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogPortal,
	DialogTitle,
} from '@/shadcn-components/ui/dialog'
import {Separator} from '@/shadcn-components/ui/separator'
import {cn} from '@/shadcn-lib/utils'
import {trpcReact} from '@/trpc/trpc'
import {useDialogOpenProps} from '@/utils/dialog'
import {tw} from '@/utils/tw'

export function DefaultCredentialsDialog() {
	const params = useQueryParams()
	const dialogProps = useDialogOpenProps('default-credentials')

	const appId = params.params.get('default-credentials-for')
	const direct = params.params.get('default-credentials-direct') === 'true'

	const launchApp = useLaunchApp()

	const title = 'Default Credentials'

	const {app, isLoading} = useUserApp(appId)

	if (isLoading || !appId || !app) {
		return null
	}

	// TODO: replace with API call
	const appName = app.name
	const defaultUsername = app.credentials.defaultUsername
	const defaultPassword = app.credentials.defaultPassword

	return (
		<Dialog {...dialogProps}>
			<DialogPortal>
				<DialogContent className='p-0'>
					<div className='umbrel-dialog-fade-scroller flex flex-col gap-y-4 overflow-y-auto p-7'>
						{/* <JSONTree data={app} /> */}
						<DialogHeader>
							<UmbrelHeadTitle>{title}</UmbrelHeadTitle>
							<DialogTitle className='flex flex-row items-center justify-between'>
								Credentials for {appName}
							</DialogTitle>
							<DialogDescription>Here are credentials you’ll need to access the app.</DialogDescription>
						</DialogHeader>
						<Separator />
						<div>
							<label className={textClass}>Default username</label>
							<CopyableField value={defaultUsername} />
						</div>
						<div>
							<label className={textClass}>Default password</label>
							<CopyableField isPassword value={defaultPassword} />
						</div>
						<p className={textClass}>You can access the default credentials of any app from its store page.</p>
						<Separator />
						<div className='flex items-center justify-between'>
							{direct && <ShowCredentialsBeforeOpenCheckbox appId={appId} />}
							{direct ? (
								<Button
									variant='primary'
									size='dialog'
									className='w-auto'
									onClick={() => launchApp(appId, {direct: true})}
								>
									Launch app
								</Button>
							) : (
								<Button
									variant='primary'
									size='dialog'
									className='w-auto'
									onClick={() => dialogProps.onOpenChange(false)}
								>
									Got it
								</Button>
							)}
						</div>
					</div>
				</DialogContent>
			</DialogPortal>
		</Dialog>
	)
}

function ShowCredentialsBeforeOpenCheckbox({appId}: {appId: string}) {
	const checkboxId = useId()
	const {app, isLoading} = useUserApp(appId)

	const showCredentials = app?.showCredentialsBeforeOpen ?? false

	const ctx = trpcReact.useContext()

	const showCredentialsBeforeOpenMut = trpcReact.user.apps.set.useMutation({
		onSuccess: () => ctx.user.apps.invalidate(),
	})

	const handleShowCredentialsBeforeOpenChange = (checked: boolean) => {
		showCredentialsBeforeOpenMut.mutate({appId, showCredentialsBeforeOpen: !checked})
	}

	return (
		<div
			className={cn(
				checkboxContainerClass,
				// prevent interaction when loading
				(isLoading || showCredentialsBeforeOpenMut.isLoading) && 'pointer-events-none',
			)}
		>
			<Checkbox
				id={checkboxId}
				checked={!showCredentials}
				onCheckedChange={(c) => handleShowCredentialsBeforeOpenChange(!!c)}
			/>
			<label htmlFor={checkboxId} className={cn(checkboxLabelClass, 'text-13')}>
				Don’t show this again
			</label>
		</div>
	)
}

const textClass = tw`text-13 font-normal text-white/40`
