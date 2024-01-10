import {useId} from 'react'

import {CopyableField} from '@/components/ui/copyable-field'
import {UmbrelHeadTitle} from '@/components/umbrel-head-title'
import {useAvailableApp} from '@/hooks/use-available-apps'
import {useQueryParams} from '@/hooks/use-query-params'
import {Button} from '@/shadcn-components/ui/button'
import {Checkbox, checkboxContainerClass, checkboxLabelClass} from '@/shadcn-components/ui/checkbox'
import {Dialog, DialogContent, DialogHeader, DialogPortal, DialogTitle} from '@/shadcn-components/ui/dialog'
import {Separator} from '@/shadcn-components/ui/separator'
import {cn} from '@/shadcn-lib/utils'
import {useDialogOpenProps} from '@/utils/dialog'
import {tw} from '@/utils/tw'

export function DefaultCredentialsDialog() {
	const params = useQueryParams()
	const dialogProps = useDialogOpenProps('default-credentials')
	const {app} = useAvailableApp(params.params.get('default-credentials-for'))

	const title = 'Default Credentials'
	const checkboxId = useId()

	// TODO: replace with API call
	const appName = app?.name || 'Unknown App'
	const defaultUsername = 'umbrel'
	const defaultPassword = 'beef38f0a3f76510d8f24e259c5c3da8c4e245bd468afdd0eabfe86a4f7813e'

	return (
		<Dialog {...dialogProps}>
			<DialogPortal>
				<DialogContent className='p-0'>
					<div className='umbrel-dialog-fade-scroller flex flex-col gap-y-4 overflow-y-auto p-7'>
						<DialogHeader>
							<UmbrelHeadTitle>{title}</UmbrelHeadTitle>
							<DialogTitle className='flex flex-row items-center justify-between'>
								Credentials for {appName}
							</DialogTitle>
						</DialogHeader>
						<p className={textClass}>Here are credentials you’ll need to access the app once installed.</p>
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
							<div className={checkboxContainerClass}>
								<Checkbox id={checkboxId} />
								<label htmlFor={checkboxId} className={cn(checkboxLabelClass, 'text-13')}>
									Don’t show this again
								</label>
							</div>
							<Button variant='primary' size='dialog' onClick={() => dialogProps.onOpenChange(false)}>
								Got it
							</Button>
						</div>
					</div>
				</DialogContent>
			</DialogPortal>
		</Dialog>
	)
}

const textClass = tw`text-13 font-normal text-white/40`
