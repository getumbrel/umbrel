import {useEffect} from 'react'
import {TbRotate2, TbServer, TbShoppingBag, TbUser} from 'react-icons/tb'
import {Link, useNavigate} from 'react-router-dom'

import {
	ImmersiveDialogBody,
	ImmersiveDialogIconMessageKeyValue,
	ImmersiveDialogSplit,
} from '@/components/ui/immersive-dialog'
import {useQueryParams} from '@/hooks/use-query-params'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {buttonClass} from '@/layouts/bare/shared'
import {Alert} from '@/modules/bare/alert'
import {Progress} from '@/modules/bare/progress'
import {bareContainerClass, BareLogoTitle, BareSpacer, bareTextClass} from '@/modules/bare/shared'
import {Button} from '@/shadcn-components/ui/button'
import {PasswordInput} from '@/shadcn-components/ui/input'
import {cn} from '@/shadcn-lib/utils'

const title = 'Factory reset'
const description = 'Delete all data, and reset your device completely'

const backPath = '/settings?dialog=factory-reset'

export default function FactoryReset() {
	return <FactoryResetImmersiveDialog />
}

function FactoryResetImmersiveDialog() {
	useUmbrelTitle(title)
	const navigate = useNavigate()
	const {params} = useQueryParams()
	const state = params.get('factory-reset-state')

	if (state === 'step-3') {
		return <Step3 />
	}

	if (state === 'step-4') {
		return <Step4 />
	}

	return (
		<ImmersiveDialogSplit
			onClose={() => navigate(backPath, {preventScrollReset: true})}
			leftChildren={<SplitLeftContent />}
		>
			{!state && <Step1 />}
			{state === 'step-2' && <Step2 />}
		</ImmersiveDialogSplit>
	)
}

function Step1() {
	const navigate = useNavigate()
	const {addLinkSearchParams} = useQueryParams()
	return (
		<ImmersiveDialogBody
			title={title}
			description={description}
			bodyText='Following will be removed completely from your device'
			footer={
				<>
					<Button
						variant='destructive'
						size='dialog'
						className='min-w-0'
						onClick={() => {
							navigate({
								search: addLinkSearchParams({
									'factory-reset-state': 'step-2',
								}),
							})
						}}
					>
						Continue
					</Button>
					<Button size='dialog' className='min-w-0' onClick={() => navigate(backPath)}>
						Cancel
					</Button>
				</>
			}
		>
			<ImmersiveDialogIconMessageKeyValue icon={TbUser} k='Account Info' v='satoshi' />
			<ImmersiveDialogIconMessageKeyValue icon={TbShoppingBag} k='Apps' v='18 installed apps' />
			<ImmersiveDialogIconMessageKeyValue icon={TbServer} k='Total data' v='628.8 GB' />
		</ImmersiveDialogBody>
	)
}

function Step2() {
	const navigate = useNavigate()
	const {addLinkSearchParams} = useQueryParams()
	return (
		<ImmersiveDialogBody
			title={title}
			description={description}
			bodyText='Confirm Umbrel password to begin resetting'
			footer={
				<>
					<Button
						variant='destructive'
						size='dialog'
						className='min-w-0'
						onClick={() => {
							navigate({
								search: addLinkSearchParams({
									'factory-reset-state': 'step-3',
								}),
							})
						}}
					>
						Erase everything & reset
					</Button>
					<div className='text-destructive2'>This action cannot be undone.</div>
				</>
			}
		>
			<label>
				<div className='mb-1 text-14 leading-tight'>Enter password</div>
				<PasswordInput sizeVariant='short' />
			</label>
		</ImmersiveDialogBody>
	)
}

function Step3() {
	const navigate = useNavigate()

	useEffect(() => {
		setTimeout(() => {
			navigate('/factory-reset?factory-reset-state=step-4')
		}, 1000)
	}, [navigate])

	return (
		<div className={bareContainerClass}>
			<BareLogoTitle>Factory Reset</BareLogoTitle>
			<BareSpacer />
			<Progress value={undefined}>Deleting apps...</Progress>
			<div className='flex-1 pt-4' />
			<Alert>Do not turn off your device until the reset is complete</Alert>
		</div>
	)
}

function Step4() {
	return (
		<div className={bareContainerClass}>
			<BareLogoTitle>Reset successful!</BareLogoTitle>
			<p className={cn(bareTextClass, 'w-[80%] sm:w-[55%]')}>
				All your apps, app data, and account details have been deleted to your device. Restart to start from scratch.
			</p>
			<BareSpacer />
			<Link to='/' className={buttonClass}>
				Restart device
			</Link>
		</div>
	)
}

function SplitLeftContent() {
	return (
		<div className='flex flex-col items-center'>
			<div
				className='grid h-[67px] w-[67px] place-items-center rounded-15 bg-destructive2'
				style={{
					boxShadow: '0 1px 1px #ffffff33 inset',
				}}
			>
				<TbRotate2 className='h-[40px] w-[40px]' />
			</div>
			<div className='mt-2.5 text-15 font-medium'>Factory Reset</div>
			<div className='text-13 opacity-40'>Umbrel</div>
		</div>
	)
}
