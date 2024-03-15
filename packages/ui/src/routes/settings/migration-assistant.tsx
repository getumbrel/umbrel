import {RiAlertFill} from 'react-icons/ri'
import {TbAlertTriangleFilled, TbArrowBadgeRight, TbInfoCircle, TbLock, TbPower, TbUsb} from 'react-icons/tb'
import {useNavigate} from 'react-router-dom'

import {ErrorAlert} from '@/components/ui/alert'
import {
	ImmersiveDialog,
	ImmersiveDialogBody,
	ImmersiveDialogIconMessage,
	ImmersiveDialogSplitContent,
} from '@/components/ui/immersive-dialog'
import {UmbrelHeadTitle} from '@/components/umbrel-head-title'
import {useQueryParams} from '@/hooks/use-query-params'
import {MigrateImage} from '@/modules/migrate/migrate-image'
import {useSettingsDialogProps} from '@/routes/settings/_components/shared'
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogContent,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/shadcn-components/ui/alert-dialog'
import {Button} from '@/shadcn-components/ui/button'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

const title = t('migration-assistant')

export default function MigrationAssistantDialog() {
	const dialogProps = useSettingsDialogProps()
	const {params} = useQueryParams()
	const state = params.get('migration-assistant-state')

	const isUmbrelHomeQ = trpcReact.migration.isUmbrelHome.useQuery()
	const isUmbrelHome = !!isUmbrelHomeQ.data

	// Don't show anything atm
	if (isUmbrelHomeQ.isLoading) return null

	if (!isUmbrelHome) {
		return (
			<AlertDialog {...dialogProps}>
				<UmbrelHeadTitle>{title}</UmbrelHeadTitle>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Please start up your Umbrel Home and open this dialog from there.</AlertDialogTitle>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogAction onClick={() => dialogProps.onOpenChange(false)}>{t('ok')}</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		)
	}

	return (
		<ImmersiveDialog {...dialogProps}>
			<UmbrelHeadTitle>{title}</UmbrelHeadTitle>
			<ImmersiveDialogSplitContent side={<MigrateImage />}>
				{!state && <MigrationAssistantPrep />}
				{state === 'prep' && <MigrationAssistantPrep />}
				{state === 'errors' && <MigrationAssistantErrors />}
				{state === 'ready' && <MigrationAssistantReady />}
			</ImmersiveDialogSplitContent>
		</ImmersiveDialog>
	)
}

function MigrationAssistantPrep() {
	const navigate = useNavigate()
	const {addLinkSearchParams} = useQueryParams()

	const buttonStartText = t('migration-assistant.prep.button-start')

	return (
		<ImmersiveDialogBody
			title={title}
			description={t('migration-assistant-description')}
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
									'migration-assistant-state': 'errors',
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
			<ImmersiveDialogIconMessage icon={TbInfoCircle} title={t('migration-assistant.prep.update')} />
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
			description={t('migration-assistant-description')}
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
									'migration-assistant-state': 'ready',
								}),
							})
						}
					>
						{t('try-again')}
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
