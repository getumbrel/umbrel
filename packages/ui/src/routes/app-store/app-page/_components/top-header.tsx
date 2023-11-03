import {AppIcon} from '@/components/app-icon'
import {Button} from '@/shadcn-components/ui/button'
import {RegistryApp} from '@/trpc/trpc'

export const TopHeader = ({app}: {app: RegistryApp}) => (
	<div className='flex flex-row items-center gap-5'>
		<AppIcon
			src={app.icon}
			size={100}
			className='rounded-20'
			style={{
				viewTransitionName: 'app-icon-' + app.id,
			}}
		/>
		<div className='flex flex-col gap-2 py-1'>
			<h1
				className='text-24 font-semibold leading-inter-trimmed'
				style={{
					viewTransitionName: 'app-name-' + app.id,
				}}
			>
				{app.name}
			</h1>
			<p
				className='text-16 leading-tight opacity-50'
				style={{
					viewTransitionName: 'app-tagline-' + app.id,
				}}
			>
				{app.tagline}
			</p>
			<div className='flex-1' />
			<div className='text-13 delay-100 animate-in fade-in slide-in-from-right-2 fill-mode-both'>{app.developer}</div>
		</div>
		<div className='flex-1' />
		<Button variant='primary' size='dialog'>
			Install <span className='opacity-50'>XX.X GB</span>
		</Button>
	</div>
)
