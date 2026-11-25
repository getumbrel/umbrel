import {HELD_LOW, layoutHook, LOW, WIDE} from '@/utils/layout'

// All of these are answers from one reading of the window (see layout.ts), so
// no two of them are ever from different moments.

/** Below the desktop layout (`max-lg`) */
const isMobile = (layout: number) => !(layout & WIDE.lg)
/** As wide as a tablet: the `panes` variant in index.css */
const hasPanes = (layout: number) => isMobile(layout) && (layout & WIDE.sm) !== 0

// Made for the '/settings' page, but probably useful elsewhere.
export const useIsMobile = layoutHook(isMobile)

export const useIsSmallMobile = layoutHook((layout) => !(layout & WIDE.md))

// Phone-sized, upright or sideways. Below this a centred window has no room, so
// screens open as drawers. Tablets and foldables are mobile, but not phones.
//
// It ignores the on-screen keyboard. In the Android app the keyboard shrinks the
// window, so typing in a window on a foldable's inner display or a tablet on its
// side made it short enough to count as a phone: the window turned into a drawer
// under the user's fingers, and the field they were typing in lost its focus.
export const useIsPhone = layoutHook((layout) => isMobile(layout) && (!hasPanes(layout) || (layout & HELD_LOW) !== 0))

// A tablet, or a window of its size: below the desktop layout, and not a phone.
// It ignores the keyboard as useIsPhone does, so what it decides (where a search
// field lives) can't change under a field that is being typed in.
export const useIsTablet = layoutHook((layout) => hasPanes(layout) && !(layout & HELD_LOW))

// The same as useIsPhone, following the window as it is, keyboard and all. For
// layouts that have to agree with the `low` and `phone-side` variants in
// index.css: it is everything below the desktop layout that the `tablet`
// variant is not.
export const useIsPhoneNow = layoutHook((layout) => isMobile(layout) && (!hasPanes(layout) || (layout & LOW) !== 0))
