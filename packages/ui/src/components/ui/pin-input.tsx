// From:
// https://github.com/leonardodino/rci/blob/77273d05278970a112cbd0e643e0d21f659be354/apps/demo/src/Example.tsx

import {CodeInput, getSegmentCssWidth} from 'rci'
import {useRef, useState} from 'react'
import {useIsFocused} from 'use-is-focused'

import {cn} from '@/shadcn-lib/utils'
import {tw} from '@/utils/tw'

// ---

const dotClass = tw`absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#D9D9D9]/10`

// ---

export type CodeState = 'input' | 'loading' | 'error' | 'success'
type PinInputProps = {
	length: number
	autoFocus?: boolean
	onCodeCheck: (code: string) => Promise<boolean>
}

export const PinInput = ({length, onCodeCheck, autoFocus}: PinInputProps) => {
	const [state, setState] = useState<CodeState>('input')
	const inputRef = useRef<HTMLInputElement>(null)
	const focused = useIsFocused(inputRef)

	const padding = '12px'
	const width = getSegmentCssWidth(padding)
	const isError = state === 'error'
	const errorClassName = tw`motion-safe:animate-shake`

	return (
		<CodeInput
			className={isError ? errorClassName : ''}
			inputClassName={tw`caret-transparent selection:bg-transparent`}
			autoFocus={autoFocus}
			length={length}
			readOnly={state !== 'input'}
			disabled={state === 'loading'}
			inputRef={inputRef}
			padding={padding}
			spacing={'10px'}
			spellCheck={false}
			inputMode='numeric'
			pattern='[0-9]*'
			autoComplete='one-time-code'
			onChange={({currentTarget: input}) => {
				// only accept numbers
				input.value = input.value.replace(/\D+/g, '')

				// auto submit on input fill
				if (input.value.length === length) {
					setState('loading')
					onCodeCheck(input.value)
						.then(() => {
							setState('success')
						})
						.catch(() => {
							setState('error')
							setTimeout(() => {
								setState('input')
								input.value = ''
								input.dispatchEvent(new Event('input'))
								input.focus()
							}, 500)
						})
				}
			}}
			renderSegment={(segment) => {
				const isCaret = focused && segment.state === 'cursor'
				const isSelection = focused && segment.state === 'selected'
				const isLoading = state === 'loading'
				const isSuccess = state === 'success'
				const isError = state === 'error'
				const isActive = isSuccess || isError || isSelection || isCaret

				const baseClassName = tw`flex h-full relative appearance-none rounded-8 border-hpx border-white/20 [--segment-color:#fff]`
				const activeClassName = tw`bg-white/5 data-[state]:border-[var(--segment-color)]`
				const loadingClassName = tw`animate-[pulse-border_1s_ease-in-out_0s_infinite]`

				const outerClassName = cn(baseClassName, isActive && activeClassName, isLoading && loadingClassName)

				const caretClassName = tw`flex-[0_0_1px] justify-self-center ml-2 my-2 w-0.5 bg-white animate-[blink-caret_1.2s_step-end_infinite]`
				const selectionClassName = tw`flex-1 m-[3px] rounded-5 bg-[var(--segment-color)] opacity-[0.15625]`

				const innerClassName = cn(isSelection && selectionClassName, isCaret && caretClassName)

				return (
					<div key={segment.index} data-state={state} className={outerClassName} style={{width}}>
						<div className={innerClassName} />
						<div className={dotClass} />
					</div>
				)
			}}
		/>
	)
}
