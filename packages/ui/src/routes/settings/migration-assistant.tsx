import {motion} from 'framer-motion'
import {Children} from 'react'
import {RiAlertFill} from 'react-icons/ri'
import {TbAlertTriangleFilled, TbArrowBadgeRight, TbLock, TbPower, TbUsb} from 'react-icons/tb'
import {useNavigate} from 'react-router-dom'

import {ErrorAlert} from '@/components/ui/alert'
import {
	immersiveDialogDescriptionClass,
	ImmersiveDialogSeparator,
	ImmersiveDialogSplit,
	immersiveDialogTitleClass,
} from '@/components/ui/immersive-dialog'
import {LargeIconButton} from '@/components/ui/large-icon-button'
import {useQueryParams} from '@/hooks/use-query-params'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {Button} from '@/shadcn-components/ui/button'

const title = 'Migration Assistant'

export function MigrationAssistantDialog() {
	useUmbrelTitle(title)
	const navigate = useNavigate()
	const {params} = useQueryParams()
	const state = params.get('migration-state')

	return (
		<ImmersiveDialogSplit
			onClose={() => navigate('/settings', {preventScrollReset: true})}
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
		<MigrationBody
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
			<LargeIconButton icon={TbPower}>Shut down Raspberry Pi Umbrel</LargeIconButton>
			<LargeIconButton icon={TbUsb}>Connect its SSD to Umbrel Home via USB</LargeIconButton>
			<LargeIconButton icon={TbArrowBadgeRight}>Once done, click ‘Continue’ below.</LargeIconButton>
		</MigrationBody>
	)
}

function MigrationAssistantErrors() {
	const navigate = useNavigate()
	const {addLinkSearchParams} = useQueryParams()

	return (
		<MigrationBody
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
			<LargeIconButton
				icon={TbAlertTriangleFilled}
				iconClassName='text-[#FFC107] [&>*]:stroke-none'
				description='Make sure you’ve connected Raspberry Pi Umbrel’s SSD to your Umbrel Home'
			>
				Couldn’t detect an SSD
			</LargeIconButton>
			<LargeIconButton
				icon={TbAlertTriangleFilled}
				iconClassName='text-[#FFC107] [&>*]:stroke-none'
				description='Make sure you’ve connected Raspberry Pi Umbrel’s SSD to your Umbrel Home'
			>
				Incorrect SSD
			</LargeIconButton>
		</MigrationBody>
	)
}

function MigrationAssistantReady() {
	const navigate = useNavigate()

	return (
		<MigrationBody
			title='You’re all set to migrate!'
			description='umbrelOS is ready to be migrated to Umbrel Home'
			bodyText='Things to keep in mind'
			footer={
				<>
					<Button variant='primary' size='dialog' className='w-full md:w-auto' onClick={() => navigate('/migrate')}>
						Continue migration
					</Button>
				</>
			}
		>
			<LargeIconButton
				icon={TbLock}
				description='Remember to use Raspberry Pi Umbrel’s password to unlock your Umbrel Home'
				className='pointer-events-none cursor-default'
			>
				Use the same password
			</LargeIconButton>
			<LargeIconButton
				icon={TbPower}
				description='This helps prevent issues with apps such as Lightning Node'
				className='pointer-events-none cursor-default'
			>
				Keep your Raspberry Pi off after the update
			</LargeIconButton>
		</MigrationBody>
	)
}

function MigrationBody({
	title,
	description,
	bodyText,
	children,
	footer,
}: {
	title: string
	description: string
	bodyText: string
	children: React.ReactNode
	footer: React.ReactNode
}) {
	return (
		<div className='flex h-full flex-col items-start gap-5'>
			<div className='space-y-2'>
				<h1 className={immersiveDialogTitleClass}>{title}</h1>
				<p className={immersiveDialogDescriptionClass}>{description}</p>
			</div>
			<ImmersiveDialogSeparator />
			<div className='text-15 font-medium leading-none -tracking-4 text-white/90'>{bodyText}</div>
			<motion.div className='w-full space-y-2.5'>
				{Children.map(children, (child, i) => (
					<motion.div
						key={i}
						initial={{opacity: 0, translateY: 10}}
						animate={{opacity: 1, translateY: 0}}
						transition={{delay: i * 0.2 + 0.1}}
					>
						{child}
					</motion.div>
				))}
			</motion.div>
			<div className='flex-1' />
			<div className='flex flex-wrap-reverse items-center gap-2'>{footer}</div>
		</div>
	)
}
