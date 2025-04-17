import {ArrowUpDown} from 'lucide-react'
import {RiArrowDropDownLine, RiArrowDropUpLine} from 'react-icons/ri'

import {SORT_BY_OPTIONS} from '@/features/files/constants'
import {usePreferences} from '@/features/files/hooks/use-preferences'
import {Button} from '@/shadcn-components/ui/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/shadcn-components/ui/dropdown-menu'
import {t} from '@/utils/i18n'

export function SortDropdown() {
	const {preferences, setSortBy} = usePreferences()

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant='default' size='default'>
					<ArrowUpDown className='h-3 w-3' />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='end' className='w-24'>
				<span className='block px-2 pb-2 text-13 text-white/40'>Sort by</span>
				{SORT_BY_OPTIONS.map((option) => (
					<DropdownMenuItem
						key={option.sortBy}
						onClick={() => setSortBy(option.sortBy)}
						className='flex items-center justify-between'
					>
						{t(option.labelTKey)}
						{option.sortBy === preferences?.sortBy && (
							<>
								{preferences.sortOrder === 'ascending' ? (
									<RiArrowDropUpLine className='h-5 w-5' />
								) : (
									<RiArrowDropDownLine className='h-5 w-5' />
								)}
							</>
						)}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
