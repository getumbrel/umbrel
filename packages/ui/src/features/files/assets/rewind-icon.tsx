import {SVGProps, useId} from 'react'

export const RewindIcon = (props: SVGProps<SVGSVGElement>) => {
	const id = useId()
	return (
		<svg xmlns='http://www.w3.org/2000/svg' width='109' height='82' fill='none' viewBox='0 0 109 82' {...props}>
			<g filter={`url(#filter0_ii_${id})`}>
				<path
					fill='hsl(var(--color-brand))'
					d='M37.19 24.831c.146-12.097.218-18.146 4.093-21.66C45.157-.344 51.184.173 63.239 1.206l22.31 1.913c10.421.893 15.631 1.34 18.791 4.782s3.16 8.671 3.16 19.13v27.412c0 10.47 0 15.705-3.165 19.149-3.164 3.443-8.38 3.884-18.814 4.765l-22.685 1.917c-12.308 1.04-18.462 1.56-22.351-2.058-3.89-3.618-3.816-9.793-3.669-22.144z'
				></path>
				<path
					fill={`url(#paint0_linear_${id})`}
					fillOpacity='0.75'
					d='M37.19 24.831c.146-12.097.218-18.146 4.093-21.66C45.157-.344 51.184.173 63.239 1.206l22.31 1.913c10.421.893 15.631 1.34 18.791 4.782s3.16 8.671 3.16 19.13v27.412c0 10.47 0 15.705-3.165 19.149-3.164 3.443-8.38 3.884-18.814 4.765l-22.685 1.917c-12.308 1.04-18.462 1.56-22.351-2.058-3.89-3.618-3.816-9.793-3.669-22.144z'
				></path>
			</g>
			<path
				fill='#fff'
				d='m79.31 26.79.001.001.136-.01h.28l.137.01.142.019.124.02.255.065.16.055.312.142.213.132.192.148.197.191.128.157.128.195.04.073.064.136.076.22.024.107.023.122.01.116.005.12v24.373c0 1.73-2.337 2.634-3.846 1.59l-.2-.154L64.695 42.43c-.408-.35-.653-.815-.69-1.309a1.84 1.84 0 0 1 .493-1.372l.197-.191 13.218-12.187.222-.168.183-.11.227-.11.086-.034.158-.055.256-.065.126-.02z'
			></path>
			<g filter={`url(#filter1_ii_${id})`}>
				<path
					fill='hsl(var(--color-brand))'
					d='M17 25c0-3.72 0-5.58.409-7.106a12 12 0 0 1 8.485-8.485C27.42 9 29.28 9 33 9v63c-3.72 0-5.58 0-7.106-.409a12 12 0 0 1-8.485-8.485C17 61.58 17 59.72 17 56z'
				></path>
				<path
					fill={`url(#paint1_linear_${id})`}
					fillOpacity='0.75'
					d='M17 25c0-3.72 0-5.58.409-7.106a12 12 0 0 1 8.485-8.485C27.42 9 29.28 9 33 9v63c-3.72 0-5.58 0-7.106-.409a12 12 0 0 1-8.485-8.485C17 61.58 17 59.72 17 56z'
				></path>
			</g>
			<g filter={`url(#filter2_ii_${id})`}>
				<path fill='hsl(var(--color-brand))' d='M1 31c0-6.627 5.373-12 12-12v44C6.373 63 1 57.627 1 51z'></path>
				<path
					fill={`url(#paint2_linear_${id})`}
					fillOpacity='0.75'
					d='M1 31c0-6.627 5.373-12 12-12v44C6.373 63 1 57.627 1 51z'
				></path>
			</g>
			<defs>
				<linearGradient id={`paint0_linear_${id}`} x1='72' x2='72' y1='-1' y2='82.5' gradientUnits='userSpaceOnUse'>
					<stop offset='0.315' stopOpacity='0'></stop>
					<stop offset='0.965' stopOpacity='0.48'></stop>
				</linearGradient>
				<linearGradient id={`paint1_linear_${id}`} x1='25' x2='25' y1='9' y2='72' gradientUnits='userSpaceOnUse'>
					<stop offset='0.315' stopOpacity='0'></stop>
					<stop offset='0.965' stopOpacity='0.48'></stop>
				</linearGradient>
				<linearGradient id={`paint2_linear_${id}`} x1='7' x2='7' y1='19' y2='63' gradientUnits='userSpaceOnUse'>
					<stop offset='0.315' stopOpacity='0'></stop>
					<stop offset='0.965' stopOpacity='0.48'></stop>
				</linearGradient>
				<filter
					id={`filter0_ii_${id}`}
					width='79.733'
					height='89.606'
					x='30.767'
					y='-5.563'
					colorInterpolationFilters='sRGB'
					filterUnits='userSpaceOnUse'
				>
					<feFlood floodOpacity='0' result='BackgroundImageFix'></feFlood>
					<feBlend in='SourceGraphic' in2='BackgroundImageFix' result='shape'></feBlend>
					<feColorMatrix
						in='SourceAlpha'
						result='hardAlpha'
						values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0'
					></feColorMatrix>
					<feOffset dx='6' dy='6'></feOffset>
					<feGaussianBlur stdDeviation='1.5'></feGaussianBlur>
					<feComposite in2='hardAlpha' k2='-1' k3='1' operator='arithmetic'></feComposite>
					<feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.25 0'></feColorMatrix>
					<feBlend in2='shape' result='effect1_innerShadow_1498_22827'></feBlend>
					<feColorMatrix
						in='SourceAlpha'
						result='hardAlpha'
						values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0'
					></feColorMatrix>
					<feOffset dx='-6' dy='-6'></feOffset>
					<feGaussianBlur stdDeviation='3'></feGaussianBlur>
					<feComposite in2='hardAlpha' k2='-1' k3='1' operator='arithmetic'></feComposite>
					<feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0'></feColorMatrix>
					<feBlend in2='effect1_innerShadow_1498_22827' result='effect2_innerShadow_1498_22827'></feBlend>
				</filter>
				<filter
					id={`filter1_ii_${id}`}
					width='25'
					height='72'
					x='11'
					y='3'
					colorInterpolationFilters='sRGB'
					filterUnits='userSpaceOnUse'
				>
					<feFlood floodOpacity='0' result='BackgroundImageFix'></feFlood>
					<feBlend in='SourceGraphic' in2='BackgroundImageFix' result='shape'></feBlend>
					<feColorMatrix
						in='SourceAlpha'
						result='hardAlpha'
						values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0'
					></feColorMatrix>
					<feOffset dx='6' dy='6'></feOffset>
					<feGaussianBlur stdDeviation='1.5'></feGaussianBlur>
					<feComposite in2='hardAlpha' k2='-1' k3='1' operator='arithmetic'></feComposite>
					<feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.25 0'></feColorMatrix>
					<feBlend in2='shape' result='effect1_innerShadow_1498_22827'></feBlend>
					<feColorMatrix
						in='SourceAlpha'
						result='hardAlpha'
						values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0'
					></feColorMatrix>
					<feOffset dx='-6' dy='-6'></feOffset>
					<feGaussianBlur stdDeviation='3'></feGaussianBlur>
					<feComposite in2='hardAlpha' k2='-1' k3='1' operator='arithmetic'></feComposite>
					<feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0'></feColorMatrix>
					<feBlend in2='effect1_innerShadow_1498_22827' result='effect2_innerShadow_1498_22827'></feBlend>
				</filter>
				<filter
					id={`filter2_ii_${id}`}
					width='21'
					height='53'
					x='-5'
					y='13'
					colorInterpolationFilters='sRGB'
					filterUnits='userSpaceOnUse'
				>
					<feFlood floodOpacity='0' result='BackgroundImageFix'></feFlood>
					<feBlend in='SourceGraphic' in2='BackgroundImageFix' result='shape'></feBlend>
					<feColorMatrix
						in='SourceAlpha'
						result='hardAlpha'
						values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0'
					></feColorMatrix>
					<feOffset dx='6' dy='6'></feOffset>
					<feGaussianBlur stdDeviation='1.5'></feGaussianBlur>
					<feComposite in2='hardAlpha' k2='-1' k3='1' operator='arithmetic'></feComposite>
					<feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.25 0'></feColorMatrix>
					<feBlend in2='shape' result='effect1_innerShadow_1498_22827'></feBlend>
					<feColorMatrix
						in='SourceAlpha'
						result='hardAlpha'
						values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0'
					></feColorMatrix>
					<feOffset dx='-6' dy='-6'></feOffset>
					<feGaussianBlur stdDeviation='3'></feGaussianBlur>
					<feComposite in2='hardAlpha' k2='-1' k3='1' operator='arithmetic'></feComposite>
					<feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0'></feColorMatrix>
					<feBlend in2='effect1_innerShadow_1498_22827' result='effect2_innerShadow_1498_22827'></feBlend>
				</filter>
			</defs>
		</svg>
	)
}
