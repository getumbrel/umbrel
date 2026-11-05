import {cva} from 'class-variance-authority'
import {useContext} from 'react'

import {Glass} from '@/components/ui/glass'
import {useTilt} from '@/components/ui/tilt'
import {cn} from '@/lib/utils'
import {useWallpaper} from '@/providers/wallpaper'
import {tw} from '@/utils/tw'

import {BackdropBlurVariantContext} from './backdrop-blur-context'

export const widgetContainerCva = cva(
	cn(
		tw`rounded-12 sm:rounded-20 w-[var(--widget-w,270px)] h-[var(--widget-h,150px)] shrink-0 flex flex-col gap-2 cursor-default text-left`,
		// animations
		tw`transition-[scale,box-shadow] duration-300 hover:scale-105`,
	),
	// ^-- Using `tw` to force vscode to recognize the tailwind classes
	{
		variants: {
			variant: {
				// bg and blur come from <Glass> (tint + backdrop-filter)
				'with-backdrop-blur': 'contrast-more:bg-neutral-900 shadow-widget-drop',
				default: 'bg-neutral-900/80 shadow-widget',
			},
		},
		defaultVariants: {
			variant: 'with-backdrop-blur',
		},
	},
)

type WidgetContainerButtonProps = React.ComponentPropsWithoutRef<'button'>
type WidgetContainerDivProps = React.ComponentPropsWithoutRef<'div'>
type WidgetContainerProps = WidgetContainerButtonProps | WidgetContainerDivProps

const widgetButtonClass = tw`ring-white/25 focus:outline-hidden focus-visible:ring-6 active:scale-95`

/** Make the widget a button if we pass an `onClick` */
export const WidgetContainer: React.FC<WidgetContainerProps> = ({className, ...props}) => {
	const variant = useContext(BackdropBlurVariantContext)
	const {staticWallpaperImgRef} = useWallpaper()
	// tvOS-style hover tilt — handlers spread onto the glass host below (mouse
	// only, respects reduced motion; drives transform without re-rendering)
	const tilt = useTilt()

	// The `default` variant is opaque (widget selector sheet) — no glass needed
	if (variant === 'default') {
		// Forcing the correct types for `props`
		// Only allow `onClick` to do something if it's truthy
		if ('onClick' in props) {
			const p = props as WidgetContainerButtonProps
			return <button className={cn(widgetContainerCva({variant}), widgetButtonClass, className)} {...p} />
		} else {
			const p = props as WidgetContainerDivProps
			return <div className={cn(widgetContainerCva({variant}), className)} {...p} />
		}
	}

	const interactive = 'onClick' in props
	return (
		<Glass
			as={interactive ? 'button' : 'div'}
			// A tight rim (rather than the default dome across the whole surface)
			// keeps the centre optically flat so content reads crisply, and
			// concentrates the refraction into a thick-glass edge.
			bevel='18px'
			edgeBlur={0}
			blur={2.0}
			scale={110}
			chroma={0.35}
			saturate={1.8}
			brightness={0.82}
			// Top-lit: light pools along the upper rim, the body sinks away from
			// the wallpaper so text keeps its contrast over bright skies.
			tint='linear-gradient(to bottom, rgb(255 255 255 / 0.08), rgb(12 14 18 / 0.24))'
			refractionTarget={staticWallpaperImgRef}
			forceRefractionTarget
			className={cn(widgetContainerCva({variant}), interactive && widgetButtonClass, className)}
			{...(props as React.HTMLAttributes<HTMLElement>)}
			{...tilt}
		/>
	)
}
