import {useSearchParams, type To} from 'react-router-dom'

import {getDialogParamKey, useLinkToDialog} from '@/utils/dialog'

/** The dialogs that open on a picker between umbrelOS and an app */
export type PickerDialogKey = 'troubleshoot' | 'terminal'

/** What a picker dialog is pointed at: nothing yet (it shows the picker), umbrelOS, or an app */
export type PickerTarget = {type: 'picker'} | {type: 'umbrelos'} | {type: 'app'; appId: string}

export function parsePickerTarget(dialogKey: PickerDialogKey, searchParams: URLSearchParams): PickerTarget {
	const appId = searchParams.get(getDialogParamKey(dialogKey, 'for'))
	if (appId) return {type: 'app', appId}
	if (searchParams.get(getDialogParamKey(dialogKey, 'target')) === 'umbrelos') return {type: 'umbrelos'}
	return {type: 'picker'}
}

/** The dialog params that point a picker dialog at `target`, for `linkToDialog` and `withDialog` */
export function pickerTargetParams(target: PickerTarget): {[param: string]: string} {
	if (target.type === 'app') return {for: target.appId}
	if (target.type === 'umbrelos') return {target: 'umbrelos'}
	return {}
}

/** A picker dialog's target, read from the URL, and links that point it elsewhere */
export function usePickerTarget(dialogKey: PickerDialogKey) {
	const [searchParams] = useSearchParams()
	const linkToDialog = useLinkToDialog()

	return {
		target: parsePickerTarget(dialogKey, searchParams),
		linkToTarget: (target: PickerTarget): To => linkToDialog(dialogKey, pickerTargetParams(target)),
	}
}
