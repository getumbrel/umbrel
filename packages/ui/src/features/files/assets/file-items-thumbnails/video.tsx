import {SVGProps} from 'react'

const SvgVideo = (props: SVGProps<SVGSVGElement>) => (
	<svg xmlns='http://www.w3.org/2000/svg' width={61} height={60} viewBox='0 0 61 60' fill='none' {...props}>
		<g clipPath='url(#video_svg__a)'>
			<g filter='url(#video_svg__b)'>
				<path
					fill='url(#video_svg__c)'
					d='m30.124 5 .293.018a2.5 2.5 0 0 1 2.19 2.19l.017.292v10l.013.375a5 5 0 0 0 4.595 4.61l.392.015h10l.293.017a2.5 2.5 0 0 1 2.19 2.19l.017.293v22.5a7.5 7.5 0 0 1-7.06 7.487l-.44.013h-25a7.5 7.5 0 0 1-7.487-7.06l-.013-.44v-35a7.5 7.5 0 0 1 7.06-7.487l.44-.013z'
				/>
			</g>
			<path
				stroke='url(#video_svg__d)'
				strokeOpacity={0.2}
				strokeWidth={0.75}
				d='M32.25 17.5v.012l.012.375v.016a5.375 5.375 0 0 0 4.94 4.956h.016l.392.016h10.004l.27.016a2.125 2.125 0 0 1 1.85 1.85l.015.27V47.5a7.125 7.125 0 0 1-6.701 7.113l-.429.012H17.624a7.125 7.125 0 0 1-7.112-6.701l-.013-.43V12.5a7.125 7.125 0 0 1 6.702-7.113l.429-.012h12.483l.27.016a2.125 2.125 0 0 1 1.85 1.85l.016.27z'
			/>
			<path
				fill='url(#video_svg__e)'
				stroke='url(#video_svg__f)'
				strokeWidth={0.75}
				d='M32.482 6.78 49.22 23.518h-11.11a5.625 5.625 0 0 1-5.624-5.623z'
			/>
			<g fill='#fff' opacity={0.5}>
				<rect width={4.184} height={4.184} x={13.018} y={9.188} opacity={0.3} rx={1} />
				<rect width={4.184} height={4.184} x={13.018} y={15.371} opacity={0.6} rx={1} />
				<rect width={4.184} height={4.184} x={13.018} y={21.555} opacity={0.8} rx={1} />
				<rect width={4.184} height={4.184} x={13.018} y={27.738} rx={1} />
				<rect width={4.184} height={4.184} x={13.018} y={33.922} opacity={0.8} rx={1} />
				<rect width={4.184} height={4.184} x={13.018} y={40.105} opacity={0.6} rx={1} />
				<rect width={4.184} height={4.184} x={13.018} y={46.289} opacity={0.3} rx={1} />
			</g>
			<g fill='#fff' clipPath='url(#video_svg__g)' opacity={0.5}>
				<rect width={4} height={4.184} x={42.847} y={21.082} opacity={0.8} rx={1} />
				<rect width={4} height={4.184} x={42.847} y={27.266} rx={1} />
				<rect width={4} height={4.184} x={42.847} y={33.449} opacity={0.8} rx={1} />
				<rect width={4} height={4.184} x={42.847} y={39.633} opacity={0.6} rx={1} />
				<rect width={4} height={4.184} x={42.847} y={45.816} opacity={0.3} rx={1} />
			</g>
			<path
				fill='url(#video_svg__h)'
				d='M25.104 25.267c-.823.032-1.58.704-1.58 1.609v11.067c0 1.206 1.345 1.998 2.4 1.413l9.987-5.534c1.086-.601 1.086-2.225 0-2.826l-9.987-5.533a1.56 1.56 0 0 0-.82-.196'
			/>
		</g>
		<defs>
			<linearGradient id='video_svg__c' x1={30.124} x2={30.124} y1={5} y2={55} gradientUnits='userSpaceOnUse'>
				<stop stopColor='#EEC7C7' />
				<stop offset={0.245} stopColor='#EBBEBE' />
				<stop offset={1} stopColor='#DA7E7E' />
			</linearGradient>
			<linearGradient id='video_svg__d' x1={30.124} x2={30.124} y1={5} y2={55} gradientUnits='userSpaceOnUse'>
				<stop stopColor='#fff' />
				<stop offset={1} stopColor='#fff' />
			</linearGradient>
			<linearGradient id='video_svg__e' x1={32.107} x2={44.539} y1={23.892} y2={11.811} gradientUnits='userSpaceOnUse'>
				<stop stopColor='#F56A6A' />
				<stop offset={1} stopColor='#E6B1B1' />
			</linearGradient>
			<linearGradient id='video_svg__f' x1={41.116} x2={32.107} y1={14.252} y2={23.892} gradientUnits='userSpaceOnUse'>
				<stop offset={0.146} stopColor='#fff' stopOpacity={0} />
				<stop offset={1} stopColor='#fff' />
			</linearGradient>
			<linearGradient id='video_svg__h' x1={30.125} x2={30.125} y1={25.266} y2={39.553} gradientUnits='userSpaceOnUse'>
				<stop stopColor='#fff' />
				<stop offset={1} stopColor='#fff' stopOpacity={0.3} />
			</linearGradient>
			<clipPath id='video_svg__a'>
				<path fill='#fff' d='M.125 0h60v60h-60z' />
			</clipPath>
			<clipPath id='video_svg__g'>
				<path fill='#fff' d='M42.847 24h4v26h-4z' />
			</clipPath>
			<filter
				id='video_svg__b'
				width={41.5}
				height={51.5}
				x={9.374}
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
				<feBlend in2='shape' result='effect1_innerShadow_1032_7565' />
				<feColorMatrix in='SourceAlpha' result='hardAlpha' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0' />
				<feOffset dx={-0.75} dy={-0.75} />
				<feGaussianBlur stdDeviation={1.5} />
				<feComposite in2='hardAlpha' k2={-1} k3={1} operator='arithmetic' />
				<feColorMatrix values='0 0 0 0 0.534993 0 0 0 0 0.171905 0 0 0 0 0.171905 0 0 0 1 0' />
				<feBlend in2='effect1_innerShadow_1032_7565' result='effect2_innerShadow_1032_7565' />
			</filter>
		</defs>
	</svg>
)
export default SvgVideo
