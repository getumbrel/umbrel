import MarkdownPrimitive from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'

import {cn} from '@/shadcn-lib/utils'

// IMPORTANT: Want to avoid any risk of tracking pixels, XSS, etc.
// NEVER ALLOW HTML IN MARKDOWN
// NEVER ALLOW IMAGES IN MARKDOWN
export function Markdown({className, ...props}: React.ComponentProps<typeof MarkdownPrimitive>) {
	return (
		<MarkdownPrimitive
			remarkPlugins={[
				[
					remarkBreaks,
					{
						softbreak: '\n',
						strongbreak: '\n',
					},
				],
				[remarkGfm, {singleTilde: false}],
			]}
			// Don't want big headings in user content
			components={{
				h1: 'h4',
				h2: 'h4',
				h3: 'h4',
				h4: 'h4',
				h5: 'h4',
				h6: 'h4',
			}}
			allowedElements={[
				'h1',
				'h2',
				'h3',
				'h4',
				'h5',
				'h6',
				'a',
				'p',
				'ul',
				'ol',
				'li',
				'em',
				'strong',
				// 'del',
				'code',
				'pre',
				'br',
			]}
			// `unwrapDisallowed` because **some text** should still render "some text" rather than nothing
			unwrapDisallowed
			// `skipHtml` still renders contents
			skipHtml
			className={cn(
				'prose prose-neutral prose-invert overflow-x-hidden prose-p:mb-3 prose-p:last:mb-0 prose-p:last:mt-3 prose-ol:pl-[1rem] prose-ul:my-3 prose-ul:pl-[1rem] prose-ul:only:my-0 prose-li:my-1 prose-li:pl-0',
				className,
			)}
			{...props}
		/>
	)
}
