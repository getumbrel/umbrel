import {H1} from '@stories/components'
import {useEffect, useRef, useState} from 'react'

import {Markdown} from '@/components/markdown'

export function MarkdownExample() {
	const inputRef = useRef<HTMLTextAreaElement>(null)
	const [input, setInput] = useState(children.trim())

	// Resize the textarea to fit its content
	useEffect(() => {
		if (inputRef.current) {
			inputRef.current.style.height = inputRef.current?.scrollHeight + 'px'
		}
	}, [input])

	return (
		<div className='p-3'>
			<H1>Markdown</H1>
			<div className='mt-2 grid grid-cols-2 gap-4'>
				<textarea
					ref={inputRef}
					className='overflow-auto rounded-4 bg-white/6 p-3 focus:bg-white/10 focus:outline-none'
					value={input}
					onChange={(e) => {
						setInput(e.target.value)
					}}
				/>
				<Markdown className='rounded-4 bg-white/6 p-3'>{input}</Markdown>
			</div>
		</div>
	)
}

const children = `
# h1 heading
## h2 heading
### h3 heading
#### h4 heading
##### h5 heading
###### h6 heading


**bold**
*italic*

The \`code\` is the \`code\`.
\`\`\`js
console.log('code block')
\`\`\`

links
- This [link](https://example.com) is the best link.
- Auto-linking: https://example.com
- Auto-linking: www.nasa.gov
- Auto-linking email: contact@example.com
- Not auto-linking: example.com

unordered list

- list
- list

ordered list

1. list
1. list
5. list

nested list

- list
	- list
		- list
		- list
		- list
	- list
		- list
			- list
			- list
			- list

---- UNSUPPORTED ----

<a href="jAva script:alert('bravo')">delta</a>

[Download Minion](https://octodex.github.com/images/minion.png "download")

<script>
alert('hello')
</script>

<em>italic</em>
<strong>bold</strong>

This ~is not~ strikethrough, but ~~this is~~!

image
![alt](https://picsum.photos/200/300)

todos

* [ ] todo
* [x] done

> A block quote with ~strikethrough~ and a URL: https://reactjs.org.

| table | table |
| ----- | ----- |
| table | table |
`
