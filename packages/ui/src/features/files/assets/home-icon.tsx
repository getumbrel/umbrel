import {SVGProps, useId} from 'react'

export const HomeIcon = (props: SVGProps<SVGSVGElement>) => {
	const id = useId()
	return (
		<svg width={18} height={16} viewBox='0 0 18 16' fill='none' xmlns='http://www.w3.org/2000/svg' {...props}>
			<g filter={`url(#filter-${id})`}>
				<path
					fillRule='evenodd'
					clipRule='evenodd'
					d='M2.78928 8.60098C2.78928 8.37912 2.52503 8.26366 2.36224 8.41439V8.41439C1.7922 8.94216 0.902249 8.90792 0.37449 8.33791C-0.153268 7.7679 -0.119009 6.87798 0.45103 6.3502L4.98636 2.15091C7.25128 0.0538645 10.7489 0.0538645 13.0137 2.15091L17.5491 6.3502C18.1191 6.87798 18.1533 7.7679 17.6255 8.33791C17.0978 8.90792 16.2078 8.94216 15.6378 8.41439V8.41439C15.4599 8.24971 15.1712 8.37585 15.1712 8.61825V12.6029C15.1712 14.1593 13.9095 15.4211 12.353 15.4211H5.60751C4.05104 15.4211 2.78928 14.1593 2.78928 12.6029V8.60098ZM11.7197 10.3156C11.7197 11.8174 10.5022 13.0349 9.00036 13.0349C7.49855 13.0349 6.28113 11.8174 6.28113 10.3156C6.28113 8.8138 7.49855 7.59635 9.00036 7.59635C10.5022 7.59635 11.7197 8.8138 11.7197 10.3156Z'
					fill='hsl(var(--color-brand))'
				/>
				<path
					fillRule='evenodd'
					clipRule='evenodd'
					d='M2.78928 8.60098C2.78928 8.37912 2.52503 8.26366 2.36224 8.41439V8.41439C1.7922 8.94216 0.902249 8.90792 0.37449 8.33791C-0.153268 7.7679 -0.119009 6.87798 0.45103 6.3502L4.98636 2.15091C7.25128 0.0538645 10.7489 0.0538645 13.0137 2.15091L17.5491 6.3502C18.1191 6.87798 18.1533 7.7679 17.6255 8.33791C17.0978 8.90792 16.2078 8.94216 15.6378 8.41439V8.41439C15.4599 8.24971 15.1712 8.37585 15.1712 8.61825V12.6029C15.1712 14.1593 13.9095 15.4211 12.353 15.4211H5.60751C4.05104 15.4211 2.78928 14.1593 2.78928 12.6029V8.60098ZM11.7197 10.3156C11.7197 11.8174 10.5022 13.0349 9.00036 13.0349C7.49855 13.0349 6.28113 11.8174 6.28113 10.3156C6.28113 8.8138 7.49855 7.59635 9.00036 7.59635C10.5022 7.59635 11.7197 8.8138 11.7197 10.3156Z'
					fill={`url(#gradient-${id})`}
				/>
			</g>
			<defs>
				<filter
					id={`filter-${id}`}
					x='-0.349953'
					y='0.228134'
					width='18.525'
					height='15.3687'
					filterUnits='userSpaceOnUse'
					colorInterpolationFilters='sRGB'
				>
					<feFlood floodOpacity={0} result='BackgroundImageFix' />
					<feBlend mode='normal' in='SourceGraphic' in2='BackgroundImageFix' result='shape' />
					<feColorMatrix
						in='SourceAlpha'
						type='matrix'
						values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0'
						result='hardAlpha'
					/>
					<feOffset dx='0.349991' dy='0.349991' />
					<feGaussianBlur stdDeviation='0.0874978' />
					<feComposite in2='hardAlpha' operator='arithmetic' k2='-1' k3='1' />
					<feColorMatrix type='matrix' values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.25 0' />
					<feBlend mode='normal' in2='shape' result='effect1_innerShadow_1076_3217' />
					<feColorMatrix
						in='SourceAlpha'
						type='matrix'
						values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0'
						result='hardAlpha'
					/>
					<feOffset dx='-0.349991' dy='-0.349991' />
					<feGaussianBlur stdDeviation='0.174996' />
					<feComposite in2='hardAlpha' operator='arithmetic' k2='-1' k3='1' />
					<feColorMatrix type='matrix' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0' />
					<feBlend mode='normal' in2='effect1_innerShadow_1076_3217' result='effect2_innerShadow_1076_3217' />
				</filter>
				<linearGradient
					id={`gradient-${id}`}
					x1='9.00004'
					y1='0.578125'
					x2='9.00004'
					y2='15.4211'
					gradientUnits='userSpaceOnUse'
				>
					<stop offset='0.315' stopOpacity={0} />
					<stop offset='0.965' stopOpacity={0.48} />
				</linearGradient>
			</defs>
		</svg>
	)
}
