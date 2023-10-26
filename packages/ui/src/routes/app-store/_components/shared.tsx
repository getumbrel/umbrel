import {tw} from '@/utils/tw'

export const cardClass = tw`rounded-20 bg-gradient-to-b from-[#24242499] to-[#18181899] px-[30px] py-[40px]`

export function SectionTitle({overline, title}: {overline: string; title: string}) {
	return (
		<div>
			<h3 className='text-12 font-bold uppercase leading-tight opacity-50 md:text-15'>{overline}</h3>
			<p className='mt-2 text-24 font-bold leading-tight md:text-32'>{title}</p>
		</div>
	)
}
