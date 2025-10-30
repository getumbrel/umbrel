import UmbrelLogo from '@/assets/umbrel-logo'
import {greetingMessage} from '@/modules/desktop/greeting-message'
import {cn} from '@/shadcn-lib/utils'

export function Header({userName}: {userName: string}) {
	const name = userName
	// Always rendering the entire component to avoid layout thrashing
	return (
		<div className={cn('relative z-10', name ? '' : 'invisible')}>
			<div className='flex flex-col items-center gap-3 px-4 md:gap-4'>
				<UmbrelLogo
					className='w-[73px] md:w-auto'
					// Need to remove `view-transition-name` because it causes the logo to
					// briefly appear over the sheets between page transitions
					ref={(ref) => {
						ref?.style?.removeProperty('view-transition-name')
					}}
				/>
				<h1 className='text-center text-19 font-bold md:text-5xl'>{greetingMessage(name)}</h1>
			</div>
		</div>
	)
}
