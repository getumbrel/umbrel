import i18next, {type TFunction} from 'i18next'

import type {Item} from '@/features/photos/hooks/use-items'
import {takenAtClock} from '@/features/photos/utils/taken-at'

// What an item is. The subKind is the finer truth when there is one: a Live
// Photo or a screenshot rather than just a photo
export function itemKindLabel(item: Pick<Item, 'kind' | 'subKind'>, t: TFunction = i18next.t) {
	return item.subKind
		? {
				live: t('photos-item.kind-live'),
				panorama: t('photos-item.kind-panorama'),
				screenshot: t('photos-item.kind-screenshot'),
				spherical: t('photos-item.kind-spherical'),
			}[item.subKind]
		: {
				photo: t('photos-item.kind-photo'),
				video: t('photos-item.kind-video'),
			}[item.kind]
}

const dateFormats = new Map<string, Intl.DateTimeFormat>()

// "Photo, 4 July 2025": the name a grid tile or filmstrip thumbnail is
// announced by, since all it shows is the picture. Read from i18next rather
// than a hook so the grid's tiles don't each subscribe to the language.
export function itemLabel(item: Item) {
	const {language} = i18next
	let format = dateFormats.get(language)
	if (!format) {
		format = new Intl.DateTimeFormat(language, {day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'})
		dateFormats.set(language, format)
	}
	// At the wall clock it was taken by, as everywhere else in Photos
	const clock = takenAtClock(item.takenAt, item.takenAtOffsetMinutes)
	return i18next.t('photos-item.label', {kind: itemKindLabel(item), date: format.format(clock.date)})
}
