import {ExpandedContent} from '@/features/files/components/floating-islands/uploading-island/expanded'
import {MinimizedContent} from '@/features/files/components/floating-islands/uploading-island/minimized'
import {Island, IslandExpanded, IslandMinimized} from '@/modules/floating-island/bare-island'

export function UploadingIsland() {
	return (
		<Island id='uploading-island' nonDismissable>
			<IslandMinimized>
				<MinimizedContent />
			</IslandMinimized>
			<IslandExpanded>
				<ExpandedContent />
			</IslandExpanded>
		</Island>
	)
}
