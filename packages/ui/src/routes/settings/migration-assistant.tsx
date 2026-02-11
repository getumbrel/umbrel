import {useEffect, useState} from 'react'
import {RiAlertFill} from 'react-icons/ri'
import {TbAlertTriangleFilled, TbArrowBadgeRight, TbLock, TbPower, TbUsb} from 'react-icons/tb'

import {ErrorAlert} from '@/components/ui/alert'
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {Button} from '@/components/ui/button'
import {
	ImmersiveDialog,
	ImmersiveDialogBody,
	ImmersiveDialogIconMessage,
	ImmersiveDialogSplitContent,
} from '@/components/ui/immersive-dialog'
import {Loading} from '@/components/ui/loading'
import {useIsHomeOrPro} from '@/hooks/use-is-home-or-pro'
import {MigrateImage} from '@/modules/migrate/migrate-image'
import {useGlobalSystemState} from '@/providers/global-system-state/index'
import {useSettingsDialogProps} from '@/routes/settings/_components/shared'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

const title = t('migration-assistant')

export default function MigrationAssistantDialog() {
	const dialogProps = useSettingsDialogProps()
	const {isHomeOrPro, isLoading, deviceName} = useIsHomeOrPro()

	// Don't show anything while loading
	if (isLoading) return null

	if (!isHomeOrPro) {
		return (
			<AlertDialog {...dialogProps}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t('migration-assistant')}</AlertDialogTitle>
					</AlertDialogHeader>
					<div className='mt-2 flex justify-center'>
						<MigrateImage />
					</div>
					<AlertDialogDescription className='text-center'>
						{t('migration-assistant-unsupported-device-description')}
					</AlertDialogDescription>
					<AlertDialogFooter>
						<AlertDialogAction onClick={() => dialogProps.onOpenChange(false)}>{t('ok')}</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		)
	}

	return (
		<ImmersiveDialog {...dialogProps}>
			<ImmersiveDialogSplitContent side={<MigrateImage />}>
				<MigrateContent deviceName={deviceName} />
			</ImmersiveDialogSplitContent>
		</ImmersiveDialog>
	)
}

type MigrationState = 'prep' | 'check' | 'error' | 'ready'

function MigrateContent({deviceName}: {deviceName: string}) {
	const {migrate} = useGlobalSystemState()

	const [state, setState] = useState<MigrationState>('prep')

	const canMigrateQ = trpcReact.migration.canMigrate.useQuery(undefined, {
		refetchOnWindowFocus: false,
		enabled: state === 'check',
	})

	// Handle state update based on query result
	useEffect(() => {
		if (state !== 'check') return // Only run when checking

		if (canMigrateQ.isSuccess) {
			if (canMigrateQ.data) {
				setState('ready')
			} else {
				setState('error')
			}
		} else if (canMigrateQ.isError) {
			setState('error')
		}
	}, [canMigrateQ.isSuccess, canMigrateQ.isError, canMigrateQ.data, state])

	const retry = () => {
		setState('check')
		canMigrateQ.refetch()
	}
	const {isFetching, error} = canMigrateQ

	// return (
	// 	<div>
	// 		<Button disabled={canMigrateQ.isFetching} onClick={retry}>
	// 			{isFetching ? <Spinner /> : null}
	// 			{error ? 'Try again' : 'Continue'}
	// 		</Button>
	// 		<JSONTree
	// 			data={{
	// 				state,
	// 				canMigrateQ,
	// 				isLoading: canMigrateQ.isLoading,
	// 				isFetching: canMigrateQ.isFetching,
	// 				isRefetching: canMigrateQ.isRefetching,
	// 				error: canMigrateQ.error?.message,
	// 			}}
	// 		/>
	// 		{canMigrateQ.error && <WarningMessage title={canMigrateQ.error.message} />}
	// 	</div>
	// )

	switch (state) {
		case 'prep':
		case 'check':
			return <MigrationAssistantPrep isLoading={isFetching} onNext={() => setState('check')} deviceName={deviceName} />
		case 'error':
			return (
				<MigrationAssistantError
					isLoading={isFetching}
					errors={error ? [error.message] : []}
					onCheckAgain={retry}
					onNext={() => setState('ready')}
					deviceName={deviceName}
				/>
			)
		case 'ready':
			return <MigrationAssistantReady onNext={migrate} deviceName={deviceName} />
	}
}

// ----

function MigrationAssistantPrep({
	isLoading,
	onNext,
	deviceName,
}: {
	isLoading: boolean
	onNext: () => void
	deviceName: string
}) {
	const buttonContinueText = t('migration-assistant.prep.button-continue')

	return (
		<ImmersiveDialogBody
			title={title}
			description={t('migration-assistant-description', {deviceName})}
			bodyText={t('migration-assistant.prep.body')}
			footer={
				<>
					<Button
						variant='primary'
						size='dialog'
						className='w-full shrink-0 md:w-auto'
						onClick={() => onNext()}
						disabled={isLoading}
					>
						{isLoading ? <Loading /> : buttonContinueText}
					</Button>
					{/* TODO: consider not extending this component and instead hardcode the alert here */}
				</>
			}
		>
			<ImmersiveDialogIconMessage icon={TbPower} title={t('migration-assistant.prep.shut-down-rpi')} />
			<ImmersiveDialogIconMessage
				icon={TbUsb}
				title={t('migration-assistant.prep.connect-disk-to-home', {deviceName})}
			/>
			<ImmersiveDialogIconMessage
				icon={TbArrowBadgeRight}
				title={t('migration-assistant.prep.prep-done-continue-message', {
					button: buttonContinueText,
				})}
			/>
		</ImmersiveDialogBody>
	)
}

// ----

export function MigrationAssistantError({
	isLoading,
	errors,
	onCheckAgain,
	onNext,
	deviceName,
}: {
	isLoading: boolean
	errors: string[]
	onCheckAgain: () => void
	onNext: () => void
	deviceName: string
}) {
	const hasErrors = errors && errors.length > 0

	return (
		<ImmersiveDialogBody
			title={title}
			description={t('migration-assistant-description', {deviceName})}
			bodyText={
				<>
					{hasErrors && t('migration-assistant.failed')}
					{isLoading && <Loading>{t('migration-assistant.failed.retrying-message')}</Loading>}
				</>
			}
			footer={
				<>
					<Button
						variant='primary'
						size='dialog'
						className='w-full md:w-auto'
						disabled={isLoading}
						onClick={() => {
							if (errors && errors.length > 0) {
								onCheckAgain()
							} else {
								onNext()
							}
						}}
					>
						{t('try-again')}
						{/* {isLoading ? <Loading /> : t('try-again')} */}
					</Button>
				</>
			}
		>
			{!errors || (errors.length === 0 && <WarningMessage title={t('unknown-error')} />)}
			{errors.map((error) => (
				<WarningMessage key={error} title={error} />
			))}
		</ImmersiveDialogBody>
	)
}

function WarningMessage({title, description}: {title: string; description?: string}) {
	return (
		<ImmersiveDialogIconMessage
			icon={TbAlertTriangleFilled}
			iconClassName='text-[#FFC107] [&>*]:stroke-none'
			title={title}
			description={description}
		/>
	)
}

// ----

export function MigrationAssistantReady({onNext, deviceName}: {onNext: () => void; deviceName: string}) {
	return (
		<ImmersiveDialogBody
			title={t('migration-assistant.ready.title')}
			description={t('migration-assistant.ready.description', {deviceName})}
			bodyText={t('migration-assistant.ready.hint-header')}
			footer={
				<>
					<Button variant='primary' size='dialog' className='w-full md:w-auto' onClick={() => onNext()}>
						{t('migration-assistant.continue-migration.ready.submit')}
					</Button>
					<ErrorAlert
						// -mr-2 to adjust the width so the alert doesn't wrap
						className='-mr-2'
						description={
							<div className='-my-1 flex items-baseline items-center gap-1'>
								<RiAlertFill className='h-3 w-3 shrink-0 translate-y-[1.5px]' />
								{t('migration-assistant.prep.callout', {deviceName})}
							</div>
						}
					/>
				</>
			}
		>
			<ImmersiveDialogIconMessage
				icon={TbLock}
				title={t('migration-assistant.ready.hint-use-same-password.title')}
				description={t('migration-assistant.ready.hint-use-same-password.description', {deviceName})}
			/>
			<ImmersiveDialogIconMessage
				icon={TbPower}
				title={t('migration-assistant.ready.hint-keep-pi-off.title')}
				description={t('migration-assistant.ready.hint-keep-pi-off.description')}
			/>
		</ImmersiveDialogBody>
	)
}
