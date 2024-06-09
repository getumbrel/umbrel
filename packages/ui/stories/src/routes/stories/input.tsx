import {H1, H2, H3} from '@stories/components'

import {Button} from '@/shadcn-components/ui/button'
import {Input, InputError, PasswordInput} from '@/shadcn-components/ui/input'
import {tw} from '@/utils/tw'

export default function InputExamples() {
	return (
		<div className='flex flex-col gap-4 bg-neutral-800 p-4'>
			<H1>Input</H1>
			<H2>sizeVariant</H2>
			<H3>default</H3>
			<Input placeholder='Name' />
			<H3>short</H3>
			<div className='flex items-center gap-2'>
				<Input sizeVariant={'short'} placeholder='Name' />
				<Button size='input-short'>Button</Button>
				<Button variant='primary' size='input-short'>
					Button
				</Button>
			</div>
			<H3>short-square</H3>
			<div className='flex items-center gap-2'>
				<Input sizeVariant={'short-square'} placeholder='Name' />
				<Button size='md-squared'>Button</Button>
				<Button variant='primary' size='md-squared'>
					Button
				</Button>
			</div>
			<H2>Disabled</H2>
			<Input placeholder='Name' disabled />
			<H2>Password</H2>
			<PasswordInput />
			<H2>Input error</H2>
			<InputErrorExample />
		</div>
	)
}

const errorClasses = {
	root: tw`space-y-[5px]`,
	input: tw``,
	error: tw`flex items-center gap-1 p-1 text-13 font-normal -tracking-2 text-destructive2-lighter`,
	icon: tw`h-4 w-4`,
}

export function InputErrorExample() {
	return (
		<div className={errorClasses.root}>
			<Input variant='destructive' placeholder='Email' defaultValue='email@email@ea' />
			<InputError>Your input is so wrong we cannot even.</InputError>
		</div>
	)
}
