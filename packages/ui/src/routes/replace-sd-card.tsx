import {Loading} from '@/components/ui/loading'
import {Button} from '@/shadcn-components/ui/button'
import {trpcReact} from '@/trpc/trpc'

export function ReplaceSdCard() {
	const versionQ = trpcReact.system.osVersion.useQuery()

	if (versionQ.isLoading) {
		return <Loading />
	}

	if (versionQ.isError || !versionQ.data) {
		return <div>Failed to get version.</div>
	}

	const version = versionQ.data

	return (
		<div className='mx-auto max-w-md space-y-4 px-4'>
			<img src='/icons/icon-dead-sd-card.svg' className='w-10' />
			It looks like the microSD card in your Raspberry Pi could fail soon. microSD cards are prone to wear and tear over
			time. But don't worry, umbrelOS stores all of your data on the external USB drive.
			<ol className='ml-4 list-decimal'>
				<li>Shutdown your Umbrel.</li>
				<li>Disconnect the Rasbperry Pi from the power supply.</li>
				<li>
					Flash{' '}
					<a
						className='underline'
						href={`https://github.com/getumbrel/umbrel-os/releases/download/v${version}/umbrel-os-v${version}.zip`}
						target='_blank'
					>
						umbrelOS {version}
					</a>{' '}
					onto a new microSD card (at least 16GB size).
				</li>
				<li>Replace the existing microSD card in your Raspberry Pi with the new one.</li>
				<li>Turn on the Raspberry Pi.</li>
			</ol>
			<p>That's it! Your Umbrel should continue to function normally after the replacement.</p>
			<Button variant='primary' size='lg'>
				Ok
			</Button>
		</div>
	)
}
