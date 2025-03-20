interface FolderIconProps {
	overlayIcon?: React.ComponentType<React.SVGProps<SVGSVGElement>>
	className?: string
}

export const FolderIcon = ({className, overlayIcon: OverlayIcon, ...svgProps}: FolderIconProps) => {
	return (
		<div className='relative'>
			<svg
				width='57'
				height='50'
				viewBox='0 0 57 50'
				fill='none'
				xmlns='http://www.w3.org/2000/svg'
				className={className}
				{...svgProps}
			>
				<g clipPath='url(#folder-clip0'>
					{/* Gray insert */}
					<g opacity='0.6' filter='url(#folder-filter0)'>
						<path
							d='M17.0326 6.81456C16.7616 5.22668 17.8377 3.77724 19.436 3.57715L41.1392 0.86014C42.7376 0.660043 44.253 1.78506 44.5239 3.37294L45.8488 11.1373L18.3575 14.579L17.0326 6.81456Z'
							fill='white'
						/>
					</g>
					{/* White instert */}
					<g filter='url(#folder-filter1)'>
						<path
							d='M11.5798 9.90146C11.3176 8.31211 12.4022 6.87309 14.0023 6.68733L50.4821 2.45217C52.0821 2.26641 53.5918 3.40424 53.8539 4.9936L54.7352 10.3361L12.461 15.244L11.5798 9.90146Z'
							fill='white'
						/>
					</g>
					{/* Folder body */}
					<g filter='url(#folder-filter2)'>
						<path
							d='M0.70639 32V15.261C0.70639 9.40584 0.70639 6.47828 2.01666 4.32368C2.7654 3.09245 3.79884 2.05901 5.03007 1.31027C7.18467 0 10.1122 0 15.9674 0C17.4916 0 18.2537 0 18.9574 0.211449C19.3656 0.334078 19.7564 0.508388 20.1204 0.730141C20.7479 1.11251 21.2571 1.67954 22.2755 2.81358L22.7476 3.33928L22.7476 3.3393C24.2151 4.9735 24.9489 5.7906 25.9211 6.22422C26.8933 6.65785 27.9915 6.65785 30.1879 6.65785H44.7064C50.3632 6.65785 53.1917 6.65785 54.949 8.41521C56.7064 10.1726 56.7064 13.001 56.7064 18.6578V32C56.7064 40.4853 56.7064 44.7279 54.0704 47.364C51.4343 50 47.1917 50 38.7064 50H18.7064C10.2211 50 5.97847 50 3.34243 47.364C0.70639 44.7279 0.70639 40.4853 0.70639 32Z'
							fill='hsl(var(--color-brand))'
						/>
						<path
							d='M0.70639 32V15.261C0.70639 9.40584 0.70639 6.47828 2.01666 4.32368C2.7654 3.09245 3.79884 2.05901 5.03007 1.31027C7.18467 0 10.1122 0 15.9674 0C17.4916 0 18.2537 0 18.9574 0.211449C19.3656 0.334078 19.7564 0.508388 20.1204 0.730141C20.7479 1.11251 21.2571 1.67954 22.2755 2.81358L22.7476 3.33928L22.7476 3.3393C24.2151 4.9735 24.9489 5.7906 25.9211 6.22422C26.8933 6.65785 27.9915 6.65785 30.1879 6.65785H44.7064C50.3632 6.65785 53.1917 6.65785 54.949 8.41521C56.7064 10.1726 56.7064 13.001 56.7064 18.6578V32C56.7064 40.4853 56.7064 44.7279 54.0704 47.364C51.4343 50 47.1917 50 38.7064 50H18.7064C10.2211 50 5.97847 50 3.34243 47.364C0.70639 44.7279 0.70639 40.4853 0.70639 32Z'
							fill='url(#folder-paint0)'
						/>
					</g>
				</g>

				{/* -- Defs -- */}
				<defs>
					{/* Shadow on right side of gray insert. Not shown in non-animating version */}
					{/* <filter
						id='folder-filter0'
						x='15.4353'
						y='-0.912903'
						width='32.1636'
						height='16.2697'
						filterUnits='userSpaceOnUse'
						colorInterpolationFilters='sRGB'
					>
						<feFlood floodOpacity='0' result='BackgroundImageFix' />
						<feColorMatrix
							in='SourceAlpha'
							type='matrix'
							values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0'
							result='hardAlpha'
						/>
						<feOffset dx='-0.777778' />
						<feGaussianBlur stdDeviation='0.388889' />
						<feComposite in2='hardAlpha' operator='out' />
						<feColorMatrix type='matrix' values='0 0 0 0 0.0745098 0 0 0 0 0.0745098 0 0 0 0 0.0823529 0 0 0 0.16 0' />
						<feBlend mode='normal' in2='BackgroundImageFix' result='effect1_dropShadow_1_651' />
						<feBlend mode='normal' in='SourceGraphic' in2='effect1_dropShadow_1_651' result='shape' />
						<feColorMatrix
							in='SourceAlpha'
							type='matrix'
							values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0'
							result='hardAlpha'
						/>
						<feOffset dx='2.625' dy='-2.625' />
						<feGaussianBlur stdDeviation='0.875' />
						<feComposite in2='hardAlpha' operator='arithmetic' k2='-1' k3='1' />
						<feColorMatrix type='matrix' values='0 0 0 0 0.159774 0 0 0 0 0.20031 0 0 0 0 0.413127 0 0 0 0.26 0' />
						<feBlend mode='normal' in2='shape' result='effect2_innerShadow_1_651' />
					</filter> */}

					{/* Shadow on left side of white insert. Not shown in non-animating version */}
					{/* <filter
						id='folder-filter1'
						x='9.98512'
						y='0.682312'
						width='46.5001'
						height='15.3394'
						filterUnits='userSpaceOnUse'
						colorInterpolationFilters='sRGB'
					>
						<feFlood floodOpacity='0' result='BackgroundImageFix' />
						<feColorMatrix
							in='SourceAlpha'
							type='matrix'
							values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0'
							result='hardAlpha'
						/>
						<feOffset dx='-0.777778' />
						<feGaussianBlur stdDeviation='0.388889' />
						<feComposite in2='hardAlpha' operator='out' />
						<feColorMatrix type='matrix' values='0 0 0 0 0.0745098 0 0 0 0 0.0745098 0 0 0 0 0.0823529 0 0 0 0.16 0' />
						<feBlend mode='normal' in2='BackgroundImageFix' result='effect1_dropShadow_1_651' />
						<feBlend mode='normal' in='SourceGraphic' in2='effect1_dropShadow_1_651' result='shape' />
						<feColorMatrix
							in='SourceAlpha'
							type='matrix'
							values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0'
							result='hardAlpha'
						/>
						<feOffset dx='2.625' dy='-2.625' />
						<feGaussianBlur stdDeviation='0.875' />
						<feComposite in2='hardAlpha' operator='arithmetic' k2='-1' k3='1' />
						<feColorMatrix type='matrix' values='0 0 0 0 0.159774 0 0 0 0 0.20031 0 0 0 0 0.413127 0 0 0 0.26 0' />
						<feBlend mode='normal' in2='shape' result='effect2_innerShadow_1_651' />
					</filter> */}

					{/* Reflective/curved edges of the folder body */}
					<filter
						id='folder-filter2'
						x='-0.29361'
						y='-1'
						width='57.5'
						height='51.5'
						filterUnits='userSpaceOnUse'
						colorInterpolationFilters='sRGB'
					>
						<feFlood floodOpacity='0' result='BackgroundImageFix' />
						<feBlend mode='normal' in='SourceGraphic' in2='BackgroundImageFix' result='shape' />
						<feColorMatrix
							in='SourceAlpha'
							type='matrix'
							values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0'
							result='hardAlpha'
						/>
						<feOffset dx='1' dy='1' />
						<feGaussianBlur stdDeviation='0.25' />
						<feComposite in2='hardAlpha' operator='arithmetic' k2='-1' k3='1' />
						<feColorMatrix type='matrix' values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.25 0' />
						<feBlend mode='normal' in2='shape' result='effect1_innerShadow_1_651' />
						<feColorMatrix
							in='SourceAlpha'
							type='matrix'
							values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0'
							result='hardAlpha'
						/>
						<feOffset dx='-1' dy='-1' />
						<feGaussianBlur stdDeviation='0.5' />
						<feComposite in2='hardAlpha' operator='arithmetic' k2='-1' k3='1' />
						<feColorMatrix type='matrix' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0' />
						<feBlend mode='normal' in2='effect1_innerShadow_1_651' result='effect2_innerShadow_1_651' />
					</filter>

					{/* Shaded dark gradient for the folder body */}
					<linearGradient id='folder-paint0' x1='28.7064' y1='0' x2='28.7064' y2='50' gradientUnits='userSpaceOnUse'>
						<stop offset='0.315' stopOpacity='0' />
						<stop offset='0.965' stopOpacity='0.48' />
					</linearGradient>

					{/* Clip path for the folder body */}
					<clipPath id='folder-clip0'>
						<rect x='0.833344' width='56' height='50' rx='10' fill='white' />
					</clipPath>
				</defs>
			</svg>

			{OverlayIcon && (
				<div className='pointer-events-none absolute left-[23%] top-[28%] h-[56%] w-[56%]'>
					{/* text-black/30 makes the embedded overlay icon slightly darker than surrounding icon*/}
					<OverlayIcon className='h-full w-full text-black/30' />
				</div>
			)}
		</div>
	)
}
