import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {H1, H2} from '@/layouts/stories'
import {Input, InputError, PasswordInput} from '@/shadcn-components/ui/input'
import {tw} from '@/utils/tw'

export function InputExamples() {
	useUmbrelTitle('Input')

	return (
		<div className='flex flex-col gap-4 bg-neutral-800 p-4'>
			<H1>Input</H1>
			<H2>Default</H2>
			<Input placeholder='Name' />
			<H2>Disabled</H2>
			<Input placeholder='Name' disabled />
			<H2>Test</H2>
			<PasswordInput />
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
