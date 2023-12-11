import {useNavigate} from 'react-router-dom'

import {NumberedList, NumberedListItem} from '@/components/ui/numbered-list'
import {UmbrelHeadTitle} from '@/components/umbrel-head-title'
import {Button} from '@/shadcn-components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogPortal,
	DialogTitle,
} from '@/shadcn-components/ui/dialog'
import {trpcReact} from '@/trpc/trpc'

const title = 'Your microSD is aging'

export function ReplaceSdCard() {
	const navigate = useNavigate()
	const versionQ = trpcReact.system.osVersion.useQuery()

	if (versionQ.isLoading) return

	if (versionQ.isError || !versionQ.data) {
		throw new Error('Failed to get version.')
	}

	const version = versionQ.data

	return (
		<Dialog defaultOpen={true} onOpenChange={(open) => !open && navigate(-1)}>
			<DialogPortal>
				<DialogContent className='overflow-y-auto px-5 sm:max-w-2xl'>
					<DialogHeader>
						<UmbrelHeadTitle>{title}</UmbrelHeadTitle>
						<DialogTitle className='space-y-5'>
							<img src='/figma-exports/sd-card-failing-icon.svg' className='h-[42px]' />
							<div>{title}</div>
						</DialogTitle>
						<DialogDescription>
							It looks like the microSD card in your Raspberry Pi could fail soon. microSD cards are prone to wear and
							tear over time. Luckily, umbrelOS stores all of your data on the external USB drive.
						</DialogDescription>
					</DialogHeader>
					<div className='space-y-4'>
						<div className='space-y-2.5'>
							<p className='text-13 font-normal -tracking-2'>Here's what you can do:</p>
							<NumberedList>
								<NumberedListItem>
									Shut down your Umbrel, and then disconnect Raspberry Pi from its power supply.
								</NumberedListItem>
								<NumberedListItem>
									Flash{' '}
									<a
										className='text-brand'
										href={`https://github.com/getumbrel/umbrel-os/releases/download/v${version}/umbrel-os-v${version}.zip`}
										target='_blank'
									>
										umbrelOS {version}
									</a>{' '}
									onto a new microSD card with a minimum 16GB capacity.
								</NumberedListItem>
								<NumberedListItem>
									Replace the existing microSD card with the new one, and turn on Raspberry Pi.
								</NumberedListItem>
							</NumberedList>
							<p className='text-13 font-normal -tracking-2'>
								That's it! Your Umbrel should continue to function normally after the replacement.
							</p>
						</div>
						<Button variant='primary' size='dialog' className='!min-w-0 px-3' onClick={() => navigate(-1)}>
							Got it
						</Button>
					</div>
				</DialogContent>
			</DialogPortal>
		</Dialog>
	)
}
