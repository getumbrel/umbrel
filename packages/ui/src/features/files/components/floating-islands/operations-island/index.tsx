import {ExpandedContent} from '@/features/files/components/floating-islands/operations-island/expanded'
import {MinimizedContent} from '@/features/files/components/floating-islands/operations-island/minimized'
import {Island, IslandExpanded, IslandMinimized} from '@/modules/floating-island/bare-island'
import {useApps} from '@/providers/apps'
import type {OperationsInProgress} from '@/providers/global-files'
import {secondsToEta} from '@/utils/seconds-to-eta'

// Progress for operations the Files transfer queue does not own (app storage
// moves, Rewind restores, work from another tab); the container decides which
export function OperationsIsland({operations}: {operations: OperationsInProgress}) {
	const {userAppsKeyed} = useApps()

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

	// Nothing has been copied yet (e.g. an app storage transfer stopping the app
	// first, or a copy still sizing up), so tell the human what's going on
	// instead of showing a dead 0%
	const isPreparing = operations.length > 0 && operations.every((op) => !op.percent && !op.bytesPerSecond)

	// A lone operation is named in the pill (the app, or the item) instead of counted
	const single = operations.length === 1 ? operations[0] : undefined
	const singleApp = single?.appId ? userAppsKeyed?.[single.appId] : undefined
	const singleLabel = single ? (singleApp?.name ?? single.file.name) : undefined

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
				<MinimizedContent
					progress={totalProgress}
					count={operations.length}
					label={singleLabel}
					eta={eta}
					type={operationType}
					isPreparing={isPreparing}
				/>
			</IslandMinimized>
			<IslandExpanded>
				<ExpandedContent
					operations={operations}
					progress={totalProgress}
					count={operations.length}
					speed={totalSpeed}
					isPreparing={isPreparing}
				/>
			</IslandExpanded>
		</Island>
	)
}
