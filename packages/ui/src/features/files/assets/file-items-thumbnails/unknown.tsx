import {SVGProps} from 'react'

const SvgUnknown = (props: SVGProps<SVGSVGElement>) => (
	<svg xmlns='http://www.w3.org/2000/svg' width={61} height={60} viewBox='0 0 61 60' fill='none' {...props}>
		<g clipPath='url(#unknown_svg__a)'>
			<g filter='url(#unknown_svg__b)'>
				<path
					fill='url(#unknown_svg__c)'
					d='m30.624 5 .293.018a2.5 2.5 0 0 1 2.19 2.19l.017.292v10l.013.375a5 5 0 0 0 4.595 4.61l.392.015h10l.293.017a2.5 2.5 0 0 1 2.19 2.19l.017.293v22.5a7.5 7.5 0 0 1-7.06 7.487l-.44.013h-25a7.5 7.5 0 0 1-7.487-7.06l-.013-.44v-35a7.5 7.5 0 0 1 7.06-7.487l.44-.013z'
				/>
			</g>
			<path
				stroke='url(#unknown_svg__d)'
				strokeOpacity={0.2}
				strokeWidth={0.75}
				d='M32.75 17.5v.012l.012.375v.016a5.374 5.374 0 0 0 4.94 4.956h.016l.392.016h10.004l.27.016a2.125 2.125 0 0 1 1.85 1.85l.015.27V47.5a7.125 7.125 0 0 1-6.701 7.113l-.429.012H18.124a7.125 7.125 0 0 1-7.112-6.701l-.013-.43V12.5a7.125 7.125 0 0 1 6.702-7.113l.429-.012h12.483l.27.016a2.125 2.125 0 0 1 1.85 1.85l.016.27z'
			/>
			<path
				fill='url(#unknown_svg__e)'
				stroke='url(#unknown_svg__f)'
				strokeWidth={0.75}
				d='M32.982 6.78 49.72 23.518h-11.11a5.625 5.625 0 0 1-5.624-5.623z'
			/>
		</g>
		<defs>
			<linearGradient id='unknown_svg__c' x1={30.624} x2={30.624} y1={5} y2={55} gradientUnits='userSpaceOnUse'>
				<stop stopColor='#A2AAE0' />
				<stop offset={1} stopColor='#C7CCEE' />
			</linearGradient>
			<linearGradient id='unknown_svg__d' x1={30.624} x2={30.624} y1={5} y2={55} gradientUnits='userSpaceOnUse'>
				<stop stopColor='#fff' />
				<stop offset={1} stopColor='#fff' />
			</linearGradient>
			<linearGradient
				id='unknown_svg__e'
				x1={32.607}
				x2={45.039}
				y1={23.892}
				y2={11.811}
				gradientUnits='userSpaceOnUse'
			>
				<stop stopColor='#838EDD' />
				<stop offset={1} stopColor='#DDE1F7' />
			</linearGradient>
			<linearGradient
				id='unknown_svg__f'
				x1={41.616}
				x2={32.607}
				y1={14.252}
				y2={23.892}
				gradientUnits='userSpaceOnUse'
			>
				<stop offset={0.146} stopColor='#fff' stopOpacity={0} />
				<stop offset={1} stopColor='#fff' />
			</linearGradient>
			<clipPath id='unknown_svg__a'>
				<path fill='#fff' d='M.625 0h60v60h-60z' />
			</clipPath>
			<filter
				id='unknown_svg__b'
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
				<feColorMatrix values='0 0 0 0 0.489647 0 0 0 0 0.531703 0 0 0 0 0.841862 0 0 0 1 0' />
				<feBlend in2='effect1_innerShadow_1032_7543' result='effect2_innerShadow_1032_7543' />
			</filter>
		</defs>
	</svg>
)
export default SvgUnknown
