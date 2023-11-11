import {DialogDescription} from '@radix-ui/react-dialog'
import {useState} from 'react'
import {toast} from 'sonner'

import {DialogMounter} from '@/components/dialog-mounter'
import {useQueryParams} from '@/hooks/use-query-params'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {Button} from '@/shadcn-components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogPortal,
	DialogTitle,
} from '@/shadcn-components/ui/dialog'
import {AnimatedInputError, Input} from '@/shadcn-components/ui/input'
import {trpcReact} from '@/trpc/trpc'

export function CommunityAppStoreDialog() {
	const title = 'Add community store'
	useUmbrelTitle(title)
	const {params, removeParam} = useQueryParams()

	// state

	const [url, setUrl] = useState('')
	const [localError, setLocalError] = useState('')

	// mutations

	const addAppStoreMut = trpcReact.appStore.addRepository.useMutation({
		onSuccess: () => {
			toast.success('Added community app store')
			removeParam('dialog')
		},
	})

	// handlers

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		addAppStoreMut.reset()
		setLocalError('')
		e.preventDefault()
		if (!url) {
			setLocalError('URL is required')
			return
		}
		addAppStoreMut.mutate({url})
	}

	const remoteFormError = !addAppStoreMut.error?.data?.zodError && addAppStoreMut.error?.message
	const formError = localError || remoteFormError

	return (
		<DialogMounter>
			<Dialog
				open={params.get('dialog') === 'add-community-store'}
				onOpenChange={(open) => !open && removeParam('dialog')}
			>
				<DialogPortal>
					<DialogContent className='p-0'>
						<div className='umbrel-dialog-fade-scroller flex flex-col gap-y-3 overflow-y-auto px-5 py-6'>
							<DialogHeader>
								<DialogTitle>Community app stores</DialogTitle>
								<DialogDescription className='text-13 text-white/50'>
									Community App Stores allow you to install apps on your Umbrel that may not be available in the
									official Umbrel App Store. They also make it easy to test beta versions of Umbrel apps, then provide
									valuable feedback to developers before they release their apps on the official Umbrel App Store.
								</DialogDescription>
								<a
									href='https://github.com/getumbrel/umbrel-community-app-store'
									className='text-13 text-brand underline'
									target='_blank'
								>
									Learn more
								</a>
							</DialogHeader>
							<p className='rounded-8 bg-yellow-700/50 p-3 text-13 text-yellow-300/80'>
								Community App Stores can be created by anyone. The apps published in them are not verified or vetted by
								the official Umbrel App Store team, and can potentially be insecure or malicious. Use caution and only
								add app stores from developers you trust.
							</p>
							<form onSubmit={handleSubmit}>
								<fieldset disabled={addAppStoreMut.isLoading} className='flex flex-col gap-5'>
									<Input
										placeholder='URL'
										value={url}
										onValueChange={setUrl}
										variant={formError ? 'destructive' : 'default'}
									/>
									<div className='-my-2.5'>
										<AnimatedInputError>{formError}</AnimatedInputError>
									</div>
									<DialogFooter>
										<Button variant='primary' size='dialog'>
											Add
										</Button>
									</DialogFooter>
								</fieldset>
							</form>
						</div>
					</DialogContent>
				</DialogPortal>
			</Dialog>
		</DialogMounter>
	)
}
