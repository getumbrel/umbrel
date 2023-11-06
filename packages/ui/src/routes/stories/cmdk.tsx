import {CmdkMenu} from '@/components/cmdk'
import {H1} from '@/layouts/stories'
import {Search} from '@/modules/desktop/desktop-misc'
import {Wallpaper} from '@/modules/desktop/wallpaper-context'
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from '@/shadcn-components/ui/command'

export function CmdkStory() {
	return (
		<div className='relative z-0'>
			<Wallpaper />
			<div className='relative flex flex-col items-center gap-4 p-4'>
				<H1>CMDK</H1>
				<Search />
				<Command loop className='max-w-sm'>
					<CommandInput placeholder='Type a command or search...' />
					<CommandList>
						<CommandEmpty>No results found.</CommandEmpty>
						<CommandGroup>
							<CommandItem>Apple</CommandItem>
							<CommandItem>Orange</CommandItem>
							<CommandItem>Banana</CommandItem>
							<CommandItem>Butter</CommandItem>
						</CommandGroup>
					</CommandList>
				</Command>
			</div>
			<CmdkMenu />
		</div>
	)
}
