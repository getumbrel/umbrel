import {ExpandedContent} from '@/features/files/components/floating-islands/operations-island/expanded'
import {MinimizedContent} from '@/features/files/components/floating-islands/operations-island/minimized'
import {Island, IslandExpanded, IslandMinimized} from '@/modules/floating-island/bare-island'
import {useGlobalFiles} from '@/providers/global-files'
import {secondsToEta} from '@/utils/seconds-to-eta'

export function OperationsIsland() {
	const {operations} = useGlobalFiles()

	let totalPercent = 0
	let maxSecondsRemaining = 0
	let totalSpeed = 0

	for (const operation of operations) {
		if (operation.secondsRemaining) {
			// For the ETA, we use the maximum secondsRemaining among operations (i.e. the worst-case)
			maxSecondsRemaining = Math.max(maxSecondsRemaining, operation.secondsRemaining)
		}
		if (operation.percent) {
			totalPercent += operation.percent
		}
		if (operation.bytesPerSecond) {
			totalSpeed += operation.bytesPerSecond
		}
	}

	const totalProgress = operations.length > 0 ? Math.round(totalPercent / operations.length) : 100
	const eta = secondsToEta(maxSecondsRemaining)

	let operationType: 'copy' | 'move' | 'mixed' = 'mixed'

	const hasCopy = operations.some((op) => op.type === 'copy')
	const hasMove = operations.some((op) => op.type === 'move')

	if (hasCopy && hasMove) {
		operationType = 'mixed'
	} else if (hasCopy) {
		operationType = 'copy'
	} else if (hasMove) {
		operationType = 'move'
	}

	return (
		<Island id='operations-island' nonDismissable>
			<IslandMinimized>
				<MinimizedContent progress={totalProgress} count={operations.length} eta={eta} type={operationType} />
			</IslandMinimized>
			<IslandExpanded>
				<ExpandedContent progress={totalProgress} count={operations.length} speed={totalSpeed} />
			</IslandExpanded>
		</Island>
	)
}
