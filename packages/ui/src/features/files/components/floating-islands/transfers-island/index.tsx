import {useMemo, useState} from 'react'

import type {TransfersView} from '@/features/files/transfers/use-transfers'
import {Island, IslandExpanded, IslandMinimized, type IslandSizes} from '@/modules/floating-island/bare-island'

import {ExpandedContent} from './expanded'
import {MinimizedContent} from './minimized'

// The Transfers island: every Files transfer (uploads, copies and moves),
// grouped by the action that started it. It names itself by what it holds. It peeks open when work arrives or needs the
// user, then settles into the pill.

const MIN_EXPANDED_HEIGHT = 150
const MAX_EXPANDED_HEIGHT = 380

// The expanded pill hugs its content: measured from the same rows it renders,
// so a batch landing shrinks it as smoothly as a drop grew it
function expandedHeight(view: TransfersView) {
	const header = 56
	let content = 0
	for (const batch of view.batches) {
		content += 22 + 18 + 12 + batch.rows.length * 28 + (batch.hiddenCount > 0 ? 18 : 0) + 8
	}
	const gaps = Math.max(0, view.batches.length - 1) * 12
	return Math.min(MAX_EXPANDED_HEIGHT, Math.max(MIN_EXPANDED_HEIGHT, header + content + gaps + 12))
}

export function TransfersIsland({view}: {view: TransfersView}) {
	// A dialog the island opened (a cancel confirmation, a collision prompt)
	// is part of its conversation: the island stays open while it is answered
	const [dialogPending, setDialogPending] = useState(false)
	const height = expandedHeight(view)
	const sizes = useMemo<IslandSizes>(
		() => ({
			minimized: {width: 150, height: 40, borderRadius: 22},
			expanded: {width: 400, height, borderRadius: 32},
		}),
		[height],
	)

	return (
		<Island
			id='transfers-island'
			nonDismissable
			sizes={sizes}
			expandKey={view.wake}
			minimizeAfter={4000}
			forceExpanded={dialogPending || view.promptOpen}
		>
			<IslandMinimized>
				<MinimizedContent view={view} />
			</IslandMinimized>
			<IslandExpanded>
				<ExpandedContent view={view} onDialogPending={setDialogPending} />
			</IslandExpanded>
		</Island>
	)
}
