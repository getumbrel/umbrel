import {DialogDescription} from '@radix-ui/react-dialog'
import {useState} from 'react'
import {useNavigate} from 'react-router-dom'

import {useAfterDelayedClose} from '@/components/client-layout'
import {DialogMounter} from '@/components/dialog-mounter'
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
import {Input} from '@/shadcn-components/ui/input'

export function AddCommunityStoreDialog() {
	const title = 'Add community store'
	useUmbrelTitle(title)
	const navigate = useNavigate()

	const [open, setOpen] = useState(true)

	useAfterDelayedClose(open, () => navigate('/app-store', {preventScrollReset: true}))

	return (
		<DialogMounter>
			<Dialog open={open} onOpenChange={setOpen}>
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
							<Input placeholder='URL' />
							<DialogFooter>
								<Button variant='primary' size='dialog'>
									Add
								</Button>
							</DialogFooter>
						</div>
					</DialogContent>
				</DialogPortal>
			</Dialog>
		</DialogMounter>
	)
}
