import {tw} from '@/utils/tw'

export const linkClass = tw`transition-colors text-brand-lighter hover:text-brand hover:underline underline-offset-4 decoration-brand/30 outline-hidden focus:underline focus:text-brand`

// On a touch screen a control smaller than a fingertip answers anywhere within 44pt of its
// middle, looking no different. Only on touch, so a mouse can't click it from beside the glyph.
// It draws ::after, leaving ::before free for a backing (the close button's)
export const touchTargetClass = tw`relative pointer-coarse:after:absolute pointer-coarse:after:top-1/2 pointer-coarse:after:left-1/2 pointer-coarse:after:size-11 pointer-coarse:after:-translate-1/2`

// A window corner's round icon button (close, back)
export const dialogHeaderCircleButtonClass = `${touchTargetClass} ${tw`rounded-full outline-hidden [&>svg]:relative [&>svg]:opacity-30 hover:[&>svg]:opacity-40 focus-visible:[&>svg]:opacity-60 focus-visible:ring-2 focus-visible:ring-ring`}`

/**
 * Shared keyboard focus ring.
 *
 * Suppresses the browser's native focus ring and draws ours in its place. Apply
 * it to the element that carries the visual `rounded-*`, since the ring is a
 * box-shadow and follows that element's own radius. Where the radius lives on a
 * parent, put the ring on an `after:inset-0 after:rounded-*` pseudo-element
 * instead (see `machines-list.tsx`).
 *
 * Elements that get their focus ring from `<Button>` already have this.
 */
export const focusRingClass = tw`outline-hidden focus-visible:ring-2 focus-visible:ring-ring`

/**
 * Focus ring for controls that sit directly on the wallpaper rather than on a
 * dark glass surface.
 *
 * `--focus-ring` is white at 25%, which reads well over the app's dark chrome but
 * measures ~1.2:1 against the lightest shipped wallpapers — far below the 3:1 that
 * WCAG 1.4.11 asks of a focus indicator. The dark offset band gives the ring an
 * edge to sit against, so it stays legible whatever the wallpaper is.
 */
export const focusRingOnWallpaperClass = tw`outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-black/40`
