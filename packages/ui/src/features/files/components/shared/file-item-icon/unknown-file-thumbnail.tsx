import {SVGProps, useId} from 'react'

// Helper function to convert a string to a hue value
const stringToHue = (str: string): number => {
	let hash = 0x811c9dc5 // FNV-1a 32-bit offset basis
	for (let i = 0; i < str.length; i++) {
		hash ^= str.charCodeAt(i)
		// FNV magic prime multiplication (shift + addition trick)
		hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)
	}

	// >>> 0 forces unsigned 32-bit
	return (hash >>> 0) % 360
}

// Helper function to convert HSL to RGB
const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
	s /= 100
	l /= 100

	const c = (1 - Math.abs(2 * l - 1)) * s
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
	const m = l - c / 2

	let r = 0
	let g = 0
	let b = 0

	if (h >= 0 && h < 60) {
		r = c
		g = x
		b = 0
	} else if (h >= 60 && h < 120) {
		r = x
		g = c
		b = 0
	} else if (h >= 120 && h < 180) {
		r = 0
		g = c
		b = x
	} else if (h >= 180 && h < 240) {
		r = 0
		g = x
		b = c
	} else if (h >= 240 && h < 300) {
		r = x
		g = 0
		b = c
	} else if (h >= 300 && h < 360) {
		r = c
		g = 0
		b = x
	}

	return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}

export const UnknownFileThumbnail = ({type = '', ...props}: {type: string} & SVGProps<SVGSVGElement>) => {
	const id = useId()
	const hue = stringToHue(type.toLowerCase())

	// Get the colors for the fold and paper
	const foldGradientDark = `hsl(${hue}, 50%, 69%)`
	const foldGradientLight = `hsl(${hue}, 61%, 90%)`
	const paperGradientDark = `hsl(${hue}, 50%, 70%)`
	const paperGradientLight = `hsl(${hue}, 53%, 90%)`

	// Get the color of the fold shadow in RGB
	const [r, g, b] = hslToRgb(hue, 50, 30)

	// Divide by 255 to get a value between 0 and 1
	const foldShadowColorRed = r / 255
	const foldShadowColorGreen = g / 255
	const foldShadowColorBlue = b / 255

	// Create a color matrix for the fold shadow
	const foldShadowColorMatrix = `0 0 0 0 ${foldShadowColorRed} 0 0 0 0 ${foldShadowColorGreen} 0 0 0 0 ${foldShadowColorBlue} 0 0 0 1 0`

	return (
		<svg xmlns='http://www.w3.org/2000/svg' width={61} height={60} viewBox='0 0 61 60' fill='none' {...props}>
			<g clipPath={`url(#${id}_svg__a)`}>
				<g filter={`url(#${id}_svg__b)`}>
					<path
						fill={`url(#${id}_svg__c)`}
						d='m30.624 5 .293.018a2.5 2.5 0 0 1 2.19 2.19l.017.292v10l.013.375a5 5 0 0 0 4.595 4.61l.392.015h10l.293.017a2.5 2.5 0 0 1 2.19 2.19l.017.293v22.5a7.5 7.5 0 0 1-7.06 7.487l-.44.013h-25a7.5 7.5 0 0 1-7.487-7.06l-.013-.44v-35a7.5 7.5 0 0 1 7.06-7.487l.44-.013z'
					/>
				</g>
				<path
					stroke={`url(#${id}_svg__d)`}
					strokeOpacity={0.2}
					strokeWidth={0.75}
					d='M32.75 17.5v.012l.012.375v.016a5.374 5.374 0 0 0 4.94 4.956h.016l.392.016h10.004l.27.016a2.125 2.125 0 0 1 1.85 1.85l.015.27V47.5a7.125 7.125 0 0 1-6.701 7.113l-.429.012H18.124a7.125 7.125 0 0 1-7.112-6.701l-.013-.43V12.5a7.125 7.125 0 0 1 6.702-7.113l.429-.012h12.483l.27.016a2.125 2.125 0 0 1 1.85 1.85l.016.27z'
				/>
				<path
					fill={`url(#${id}_svg__e)`}
					stroke={`url(#${id}_svg__f)`}
					strokeWidth={0.75}
					d='M32.982 6.78 49.72 23.518h-11.11a5.625 5.625 0 0 1-5.624-5.623z'
				/>
			</g>
			<defs>
				{/* Paper */}
				<linearGradient id={`${id}_svg__c`} x1={30.624} x2={30.624} y1={5} y2={55} gradientUnits='userSpaceOnUse'>
					<stop stopColor={paperGradientDark} />
					<stop offset={1} stopColor={paperGradientLight} />
				</linearGradient>

				{/* Paper border */}
				<linearGradient id={`${id}_svg__d`} x1={30.624} x2={30.624} y1={5} y2={55} gradientUnits='userSpaceOnUse'>
					<stop stopColor='#fff' />
					<stop offset={1} stopColor='#fff' />
				</linearGradient>

				{/* Fold */}
				<linearGradient
					id={`${id}_svg__e`}
					x1={32.607}
					x2={45.039}
					y1={23.892}
					y2={11.811}
					gradientUnits='userSpaceOnUse'
				>
					<stop stopColor={foldGradientDark} />
					<stop offset={1} stopColor={foldGradientLight} />
				</linearGradient>

				{/* Fold border */}
				<linearGradient
					id={`${id}_svg__f`}
					x1={41.616}
					x2={32.607}
					y1={14.252}
					y2={23.892}
					gradientUnits='userSpaceOnUse'
				>
					<stop offset={0.146} stopColor='#fff' stopOpacity={0} />
					<stop offset={1} stopColor='#fff' />
				</linearGradient>
				<clipPath id={`${id}_svg__a`}>
					<path fill='#fff' d='M.625 0h60v60h-60z' />
				</clipPath>
				<filter
					id={`${id}_svg__b`}
					width={41.5}
					height={51.5}
					x={9.874}
					y={4.25}
					colorInterpolationFilters='sRGB'
					filterUnits='userSpaceOnUse'
				>
					<feFlood floodOpacity={0} result='BackgroundImageFix' />
					<feBlend in='SourceGraphic' in2='BackgroundImageFix' result='shape' />
					<feColorMatrix in='SourceAlpha' result='hardAlpha' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0' />
					<feOffset dx={1.5} dy={1.5} />
					<feGaussianBlur stdDeviation={0.375} />
					<feComposite in2='hardAlpha' k2={-1} k3={1} operator='arithmetic' />
					<feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.44 0' />
					<feBlend in2='shape' result='effect1_innerShadow_1032_7543' />
					<feColorMatrix in='SourceAlpha' result='hardAlpha' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0' />
					<feOffset dx={-0.75} dy={-0.75} />
					<feGaussianBlur stdDeviation={1.5} />
					<feComposite in2='hardAlpha' k2={-1} k3={1} operator='arithmetic' />
					{/* Inner shadow */}
					<feColorMatrix values={foldShadowColorMatrix} />
					<feBlend in2='effect1_innerShadow_1032_7543' result='effect2_innerShadow_1032_7543' />
				</filter>
			</defs>
		</svg>
	)
}
