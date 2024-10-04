import MarkdownPrimitive from 'react-markdown'
import {useLocation} from 'react-router-dom'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'

import {cn} from '@/shadcn-lib/utils'
import {tw} from '@/utils/tw'

// IMPORTANT: Want to avoid any risk of tracking pixels, XSS, etc.
// NEVER ALLOW HTML IN MARKDOWN
// NEVER ALLOW IMAGES IN MARKDOWN
export function Markdown({className, ...props}: React.ComponentProps<typeof MarkdownPrimitive>) {
	const {pathname} = useLocation()
	const isInCommunityAppStore = pathname.startsWith('/community-app-store')

	if (isInCommunityAppStore) {
		return <div className={cn(textClass, 'whitespace-pre-line', className)} {...props} />
	}

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
				a: (props) => (
					<a
						className='decoration-white/30 underline-offset-2 outline-none transition-opacity hover:opacity-80 focus:opacity-80'
						target='_blank'
						{...props}
					/>
				),
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
			className={cn(textClass, className)}
			{...props}
		/>
	)
}

const textClass = tw`prose prose-sm prose-neutral prose-invert overflow-x-hidden`
