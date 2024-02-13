import {RiAlertFill} from 'react-icons/ri'
import {TbAlertTriangleFilled, TbArrowBadgeRight, TbLock, TbPower, TbUsb} from 'react-icons/tb'
import {useNavigate} from 'react-router-dom'

import {ErrorAlert} from '@/components/ui/alert'
import {ImmersiveDialogBody, ImmersiveDialogIconMessage, ImmersiveDialogSplit} from '@/components/ui/immersive-dialog'
import {useQueryParams} from '@/hooks/use-query-params'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {MigrateImage} from '@/modules/migrate/migrate-image'
import {Button} from '@/shadcn-components/ui/button'
import {trpcReact} from '@/trpc/trpc'
import {useDialogOpenProps} from '@/utils/dialog'
import {t} from '@/utils/i18n'

const title = t('migration-assistant')

export default function MigrationAssistantDialog() {
	useUmbrelTitle(title)
	const dialogProps = useDialogOpenProps('migration-assistant')
	const {params} = useQueryParams()
	const state = params.get('migration-state')

	return (
		<ImmersiveDialogSplit onClose={() => dialogProps.onOpenChange(false)} leftChildren={<MigrateImage />}>
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

	const buttonStartText = t('migration-assistant.prep.button-start')

	return (
		<ImmersiveDialogBody
			title={title}
			description={t('migration-assistant.description')}
			bodyText={t('migration-assistant.prep.body')}
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
						{buttonStartText}
					</Button>
					{/* TODO: consider not extending this component and instead hardcode the alert here */}
					<ErrorAlert
						// -mr-2 to adjust the width so the alert doesn't wrap
						className='-mr-2'
						description={
							<div className='-my-1 flex items-center items-baseline gap-1'>
								<RiAlertFill className='h-3 w-3 shrink-0 translate-y-[1.5px]' />
								{t('migration-assistant.prep.callout')}
							</div>
						}
					/>
				</>
			}
		>
			<ImmersiveDialogIconMessage icon={TbPower} title={t('migration-assistant.prep.shut-down-rpi')} />
			<ImmersiveDialogIconMessage icon={TbUsb} title={t('migration-assistant.prep.connect-disk-to-home')} />
			<ImmersiveDialogIconMessage
				icon={TbArrowBadgeRight}
				title={t('migration-assistant.prep.prep-done-continue-message', {
					button: buttonStartText,
				})}
			/>
		</ImmersiveDialogBody>
	)
}

function MigrationAssistantErrors() {
	const navigate = useNavigate()
	const {addLinkSearchParams} = useQueryParams()

	return (
		<ImmersiveDialogBody
			title={title}
			description={t('migration-assistant.description')}
			bodyText={t('migration-assistant.failed')}
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
						{t('migration-assistant.try-again')}
					</Button>
				</>
			}
		>
			<ImmersiveDialogIconMessage
				icon={TbAlertTriangleFilled}
				iconClassName='text-[#FFC107] [&>*]:stroke-none'
				title={t('migration-assistant.failed.ssd-not-detected.title')}
				description={t('migration-assistant.failed.ssd-not-detected.description')}
			/>
			<ImmersiveDialogIconMessage
				icon={TbAlertTriangleFilled}
				iconClassName='text-[#FFC107] [&>*]:stroke-none'
				title={t('migration-assistant.failed.incorrect-ssd.title')}
				description={t('migration-assistant.failed.incorrect-ssd.description')}
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
			title={t('migration-assistant.ready.title')}
			description={t('migration-assistant.ready.description')}
			bodyText={t('migration-assistant.ready.hint-header')}
			footer={
				<>
					<Button variant='primary' size='dialog' className='w-full md:w-auto' onClick={() => migrateMut.mutate()}>
						{t('migration-assistant.continue-migration.ready.submit')}
					</Button>
				</>
			}
		>
			<ImmersiveDialogIconMessage
				icon={TbLock}
				title={t('migration-assistant.ready.hint-use-same-password.title')}
				description={t('migration-assistant.ready.hint-use-same-password.description')}
			/>
			<ImmersiveDialogIconMessage
				icon={TbPower}
				title={t('migration-assistant.ready.hint-keep-pi-off.title')}
				description={t('migration-assistant.ready.hint-keep-pi-off.description')}
			/>
		</ImmersiveDialogBody>
	)
}
