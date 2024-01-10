import {RiAlertFill} from 'react-icons/ri'
import {TbAlertTriangleFilled, TbArrowBadgeRight, TbLock, TbPower, TbUsb} from 'react-icons/tb'
import {useNavigate} from 'react-router-dom'

import {ErrorAlert} from '@/components/ui/alert'
import {ImmersiveDialogBody, ImmersiveDialogIconMessage, ImmersiveDialogSplit} from '@/components/ui/immersive-dialog'
import {useQueryParams} from '@/hooks/use-query-params'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {Button} from '@/shadcn-components/ui/button'
import {trpcReact} from '@/trpc/trpc'
import {useDialogOpenProps} from '@/utils/dialog'

const title = 'Migration Assistant'

export default function MigrationAssistantDialog() {
	useUmbrelTitle(title)
	const dialogProps = useDialogOpenProps('migration-assistant')
	const {params} = useQueryParams()
	const state = params.get('migration-state')

	return (
		<ImmersiveDialogSplit
			onClose={() => dialogProps.onOpenChange(false)}
			leftChildren={
				<img
					src='/migration-assistant/migrate-raspberrypi-umbrel-home.png'
					width={111}
					height={104}
					alt='Image displaying migration from Raspberry Pi to Umbrel Home'
				/>
			}
		>
			{!state && <MigrationAssistantPrep />}
			{state === 'prep' && <MigrationAssistantPrep />}
			{state === 'errors' && <MigrationAssistantErrors />}
			{state === 'ready' && <MigrationAssistantReady />}
		</ImmersiveDialogSplit>
	)
}

function MigrationAssistantPrep() {
	const navigate = useNavigate()
	const {addLinkSearchParams} = useQueryParams()

	return (
		<ImmersiveDialogBody
			title={title}
			description='Transfer your umbrelOS from a Pi-based device to Umbrel Home in 3 steps'
			bodyText='Prepare for migration'
			footer={
				<>
					<Button
						variant='primary'
						size='dialog'
						className='w-full shrink-0 md:w-auto'
						onClick={() => {
							navigate({
								search: addLinkSearchParams({
									'migration-state': 'errors',
								}),
							})
						}}
					>
						Start Migration
					</Button>
					{/* TODO: consider not extending this component and instead hardcode the alert here */}
					<ErrorAlert
						// -mr-2 to adjust the width so the alert doesn't wrap
						className='-mr-2'
						description={
							<div className='-my-1 flex items-center items-baseline gap-1'>
								<RiAlertFill className='h-3 w-3 shrink-0 translate-y-[1.5px]' />
								The data in Umbrel Home, if any, will be permanently deleted
							</div>
						}
					/>
				</>
			}
		>
			<ImmersiveDialogIconMessage icon={TbPower} title='Shut down Raspberry Pi Umbrel' />
			<ImmersiveDialogIconMessage icon={TbUsb} title='Connect its SSD to Umbrel Home via USB' />
			<ImmersiveDialogIconMessage icon={TbArrowBadgeRight} title='Once done, click ‘Continue’ below.' />
		</ImmersiveDialogBody>
	)
}

function MigrationAssistantErrors() {
	const navigate = useNavigate()
	const {addLinkSearchParams} = useQueryParams()

	return (
		<ImmersiveDialogBody
			title={title}
			description='Transfer your umbrelOS from a Pi-based device to Umbrel Home in 3 steps'
			bodyText='Something’s not right...'
			footer={
				<>
					<Button
						variant='primary'
						size='dialog'
						className='w-full md:w-auto'
						onClick={() =>
							navigate({
								search: addLinkSearchParams({
									'migration-state': 'ready',
								}),
							})
						}
					>
						Try Again
					</Button>
				</>
			}
		>
			<ImmersiveDialogIconMessage
				icon={TbAlertTriangleFilled}
				iconClassName='text-[#FFC107] [&>*]:stroke-none'
				title='Couldn’t detect an SSD'
				description='Make sure you’ve connected Raspberry Pi Umbrel’s SSD to your Umbrel Home'
			/>
			<ImmersiveDialogIconMessage
				icon={TbAlertTriangleFilled}
				iconClassName='text-[#FFC107] [&>*]:stroke-none'
				title='Incorrect SSD'
				description='Make sure you’ve connected Raspberry Pi Umbrel’s SSD to your Umbrel Home'
			/>
		</ImmersiveDialogBody>
	)
}

function MigrationAssistantReady() {
	const navigate = useNavigate()

	const migrateMut = trpcReact.migration.migrate.useMutation({
		onSuccess: () => navigate('/migrate'),
	})

	return (
		<ImmersiveDialogBody
			title='You’re all set to migrate!'
			description='umbrelOS is ready to be migrated to Umbrel Home'
			bodyText='Things to keep in mind'
			footer={
				<>
					<Button variant='primary' size='dialog' className='w-full md:w-auto' onClick={() => migrateMut.mutate()}>
						Continue migration
					</Button>
				</>
			}
		>
			<ImmersiveDialogIconMessage
				icon={TbLock}
				title='Use the same password'
				description='Remember to use Raspberry Pi Umbrel’s password to unlock your Umbrel Home'
			/>
			<ImmersiveDialogIconMessage
				icon={TbPower}
				title='Keep your Raspberry Pi off after the update'
				description='This helps prevent issues with apps such as Lightning Node'
			/>
		</ImmersiveDialogBody>
	)
}
