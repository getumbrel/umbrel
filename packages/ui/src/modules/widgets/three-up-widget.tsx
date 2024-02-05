import {cn} from '@/shadcn-lib/utils'

import {WidgetContainer, widgetTextCva} from './shared/shared'
import {TablerIcon} from './shared/tabler-icon'

type ThreeUpItem = {icon: string; title?: string; value?: string}

export function ThreeUpWidget({
	items,
	onClick,
}: {
	items?: [ThreeUpItem, ThreeUpItem, ThreeUpItem]
	onClick?: () => void
}) {
	return (
		<WidgetContainer
			onClick={onClick}
			className='flex flex-col items-stretch justify-stretch gap-1.5 p-1.5 md:flex-row md:gap-2 md:px-4 md:py-3'
		>
			{items?.[0] && <ThreeUpItem iconName={items[0].icon} title={items[0].title} value={items[0].value} />}
			{items?.[1] && <ThreeUpItem iconName={items[1].icon} title={items[1].title} value={items[1].value} />}
			{items?.[2] && <ThreeUpItem iconName={items[2].icon} title={items[2].title} value={items[2].value} />}
			{!items && (
				<>
					<ThreeUpItem iconName='' title='–' value='–' />
					<ThreeUpItem iconName='' title='–' value='–' />
					<ThreeUpItem iconName='' title='–' value='–' />
				</>
			)}
		</WidgetContainer>
	)
}

function ThreeUpItem({iconName, title, value}: {iconName: string; title?: string; value?: string}) {
	return (
		// NOTE: consider reducing rounding if we don't have 3 items
		<div className='flex min-w-0 flex-1 items-center overflow-hidden rounded-5 bg-white/5 px-1 max-md:gap-1 max-md:px-1 md:flex-col md:justify-center md:rounded-full'>
			{/* `[&>svg]` to select child svg */}
			<TablerIcon iconName={iconName} className='h-5 w-5 [&>svg]:h-5 [&>svg]:w-5' />
			<p className={cn(widgetTextCva({opacity: 'secondary'}), 'max-w-full truncate max-sm:hidden md:mt-4')}>{title}</p>
			<p className={cn(widgetTextCva(), 'max-w-full truncate')}>{value}</p>
		</div>
	)
}
