// Storage made of SSDs is told about SSDs, not "drives". A sentence that speaks of drives has
// a second form for that, its key with "_ssd" on the end, which i18next picks when asked for
// the 'ssd' context. A sentence without one reads the same either way, so nothing has to be
// decided where it is used: the screens only say once what the storage is made of.

import type {TFunction} from 'i18next'
import {createContext, useContext} from 'react'
import {useTranslation} from 'react-i18next'

import type {DriveKind} from './model'

// The translate function for a storage, or a drive, of one kind
export function forKind(t: TFunction, kind: DriveKind | 'drive'): TFunction {
	if (kind !== 'ssd') return t
	const translate = (key: string, options?: Record<string, unknown>) => t(key, {context: 'ssd', ...options})
	return translate as unknown as TFunction
}

const SsdContext = createContext(false)

// Says that everything beneath is about SSDs
export function SsdWords({ssd, children}: {ssd: boolean; children: React.ReactNode}) {
	return <SsdContext value={ssd}>{children}</SsdContext>
}

// useTranslation, in the words of the storage it is used under
export function useStorageTranslation() {
	const {t, i18n} = useTranslation()
	const ssd = useContext(SsdContext)
	return {t: ssd ? forKind(t, 'ssd') : t, i18n}
}
