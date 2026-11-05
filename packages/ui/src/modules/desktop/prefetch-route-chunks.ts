import {prefetchGlobalDialog} from '@/modules/global-dialogs'

// Warm the lazy route chunks behind the dock icons so the first click mounts
// without a network wait. These are static JS files — no auth required to
// fetch them. Called on desktop idle and again when the pointer reaches the
// dock; repeat calls are free since dynamic imports cache their promise.
export function prefetchRouteChunks() {
	import('@/features/app-store')
	import('@/features/app-store/components/discover')
	import('@/features/app-store/components/app-page')
	import('@/features/app-store/components/category')
	// The settings route itself is statically bundled; its content is the lazy chunk
	import('@/routes/settings/_components/settings-content')
	import('@/routes/settings/_components/settings-content-mobile')
	import('@/features/files')
	import('@/features/photos')
	import('@/features/machines')
	import('@/features/machines/components/machines-index')
	import('@/routes/edit-widgets')
	prefetchGlobalDialog('live-usage')
}
