import {motion} from 'framer-motion'
import {LucideIcon} from 'lucide-react'
import {Children, ReactNode} from 'react'
import type {IconType} from 'react-icons'
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
import {useQueryParams} from '@/hooks/use-query-params'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {Button} from '@/shadcn-components/ui/button'
import {cn} from '@/shadcn-lib/utils'

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
			<IconMessage icon={TbPower} title='Shut down Raspberry Pi Umbrel' />
			<IconMessage icon={TbUsb} title='Connect its SSD to Umbrel Home via USB' />
			<IconMessage icon={TbArrowBadgeRight} title='Once done, click ‘Continue’ below.' />
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
			<IconMessage
				icon={TbAlertTriangleFilled}
				iconClassName='text-[#FFC107] [&>*]:stroke-none'
				title='Couldn’t detect an SSD'
				description='Make sure you’ve connected Raspberry Pi Umbrel’s SSD to your Umbrel Home'
			/>
			<IconMessage
				icon={TbAlertTriangleFilled}
				iconClassName='text-[#FFC107] [&>*]:stroke-none'
				title='Incorrect SSD'
				description='Make sure you’ve connected Raspberry Pi Umbrel’s SSD to your Umbrel Home'
			/>
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
			<IconMessage
				icon={TbLock}
				title='Use the same password'
				description='Remember to use Raspberry Pi Umbrel’s password to unlock your Umbrel Home'
			/>
			<IconMessage
				icon={TbPower}
				title='Keep your Raspberry Pi off after the update'
				description='This helps prevent issues with apps such as Lightning Node'
			/>
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

export function IconMessage({
	icon,
	title,
	description,
	className,
	iconClassName,
}: {
	icon: IconType | LucideIcon
	title: ReactNode
	description?: ReactNode
	className?: string
	iconClassName?: string
}) {
	const IconComponent = icon

	return (
		<div
			className={cn(
				'inline-flex w-full items-center gap-2 rounded-10 border border-white/4 bg-white/4 p-2 text-left font-normal',
				className,
			)}
			style={{
				boxShadow: '0px 40px 60px 0px rgba(0, 0, 0, 0.10)',
			}}
		>
			<div className='flex h-8 w-8 shrink-0 items-center justify-center rounded-8 bg-white/4'>
				<IconComponent className={cn('h-5 w-5 [&>*]:stroke-1', iconClassName)} />
			</div>
			<div className='space-y-1'>
				<div className='text-13 font-normal leading-tight -tracking-2'>{title}</div>
				{description && (
					<div className='text-12 font-normal leading-tight -tracking-2 text-white/50'>{description}</div>
				)}
			</div>
		</div>
	)
}
