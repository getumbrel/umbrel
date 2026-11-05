import {useLocation, useParams} from 'react-router-dom'

import {isCollectionSection, sectionPath} from '@/features/photos/constants'

// What kind of page the actions bar is on, from the route: a collection
// (albums/people/locations), Sources, the map, or a grid — and among grids,
// a timeline (everything but Deleted)
export function useBarRoute() {
	const route = useParams().section
	const collection = isCollectionSection(route) ? route : undefined
	// Sources is its own route (no :section param), so it's told apart by path
	const {pathname} = useLocation()
	const isSources = pathname === sectionPath('sources')
	// The map has a grid too — the list beside it — but no timeline controls
	const isMap = pathname === sectionPath('map')
	const inDeleted = route === 'deleted'
	// The map's list is desktop's alone: on phones the map has no grid to select in
	const hasGrid = collection === undefined && !isSources && !isMap
	return {collection, isSources, isMap, inDeleted, hasGrid, isTimeline: hasGrid && !inDeleted}
}
