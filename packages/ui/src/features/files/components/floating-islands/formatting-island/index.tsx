import {useExternalStorage} from '@/features/files/hooks/use-external-storage'
import {Island, IslandExpanded, IslandMinimized} from '@/modules/floating-island/bare-island'

import {ExpandedContent} from './expanded'
import {MinimizedContent} from './minimized'

type FormattingDevice = {
	id: string
	name: string
	size: number
}

export function FormattingIsland() {
	// Get external storage devices from hook
	const {disks} = useExternalStorage()

	// Filter devices that are currently being formatted
	const formattingDevices: FormattingDevice[] =
		disks
			?.filter((disk) => disk.isFormatting)
			.map((disk) => ({
				id: disk.id,
				name: disk.name,
				size: disk.size,
			})) ?? []

	const count = formattingDevices.length

	return (
		<Island id='formatting-island' nonDismissable>
			<IslandMinimized>
				<MinimizedContent count={count} />
			</IslandMinimized>
			<IslandExpanded>
				<ExpandedContent devices={formattingDevices} />
			</IslandExpanded>
		</Island>
	)
}
