import {TbPhoto} from 'react-icons/tb'

import {ChevronDown} from '@/assets/chevron-down'
import {IconButton} from '@/components/ui/icon-button'
import {WallpaperPicker} from '@/routes/settings/_components/wallpaper-picker'
import {DropdownMenu, DropdownMenuContent, DropdownMenuTrigger} from '@/shadcn-components/ui/dropdown-menu'

export function WallpaperDropdown() {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<IconButton icon={TbPhoto}>
					Wallpaper
					<ChevronDown />
				</IconButton>
			</DropdownMenuTrigger>
			<DropdownMenuContent>
				<WallpaperPicker maxW={300} />
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
