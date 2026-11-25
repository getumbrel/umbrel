import {useMemo} from 'react'
import {useTranslation} from 'react-i18next'

import {formatNumberI18n} from '@/utils/number'

// A number in running text whose digits roll to their new values — "2
// selected" becoming "3 selected" as a marquee grows, "431 items" counting
// down after a delete — instead of the text snapping. Each digit is a column
// of the locale's ten digits slid to the right one with a transition, so a
// change mid-roll just retargets; nothing is keyed or remounted. Separators
// stay as they are, and a column that appears (9 → 10) fades in already
// showing its digit. Columns are keyed from the right, so the units column
// keeps rolling when a tens column joins it.
export function CountText({text, number}: {text: string; number: string}) {
	const {i18n} = useTranslation()
	// The locale's digit glyphs, so a column rolls in whichever script the number is written in
	const digits = useMemo(
		() =>
			Array.from({length: 10}, (_, digit) => formatNumberI18n({n: digit, showDecimals: false, locale: i18n.language})),
		[i18n.language],
	)
	const at = text.indexOf(number)
	if (at === -1) return text
	const chars = [...number]
	return (
		<>
			<span className='sr-only'>{text}</span>
			<span aria-hidden className='tabular-nums'>
				{text.slice(0, at)}
				{chars.map((char, index) => {
					const key = chars.length - index
					const digit = digits.indexOf(char)
					return digit === -1 ? (
						<span key={`c${key}`}>{char}</span>
					) : (
						<span
							key={`d${key}`}
							className='inline-block h-[1lh] w-[1ch] overflow-hidden align-top motion-safe:animate-in motion-safe:duration-200 motion-safe:fade-in'
						>
							<span
								className='block transition-transform duration-300 ease-out motion-reduce:transition-none'
								style={{transform: `translateY(calc(${-digit} * 1lh))`}}
							>
								{digits.map((glyph) => (
									<span key={glyph} className='block h-[1lh]'>
										{glyph}
									</span>
								))}
							</span>
						</span>
					)
				})}
				{text.slice(at + number.length)}
			</span>
		</>
	)
}
