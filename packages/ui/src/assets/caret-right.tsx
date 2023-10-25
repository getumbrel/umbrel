const SvgComponent = ({className}: {className?: string}) => (
	<svg xmlns='http://www.w3.org/2000/svg' width={27} height={26} fill='none' className={className}>
		<g clipPath='url(#a)'>
			<path fill='currentColor' d='M14.75 12.98 9.47 7.7l1.508-1.508 6.789 6.788-6.789 6.788L9.47 18.26l5.28-5.28Z' />
		</g>
		<defs>
			<clipPath id='a'>
				<path fill='currentColor' d='M.7.18h25.6v25.6H.7z' />
			</clipPath>
		</defs>
	</svg>
)
export default SvgComponent
