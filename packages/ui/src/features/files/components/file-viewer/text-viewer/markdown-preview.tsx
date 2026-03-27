import ReactMarkdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'

// Block dangerous elements, allow everything else
const DISALLOWED_ELEMENTS = [
	'script',
	'style',
	'iframe',
	'object',
	'embed',
	'form',
	'svg',
	'math',
	'link',
	'meta',
	'base',
]

interface MarkdownPreviewProps {
	content: string
}

export function MarkdownPreview({content}: MarkdownPreviewProps) {
	return (
		<div className='h-full overflow-auto p-6'>
			<div className='prose prose-sm max-w-none prose-invert prose-headings:font-semibold prose-headings:-tracking-2 prose-headings:text-white/90 prose-p:text-white/60 prose-a:text-white/70 prose-a:underline prose-a:decoration-white/20 hover:prose-a:decoration-white/40 prose-blockquote:border-white/10 prose-blockquote:text-white/40 prose-strong:text-white/80 prose-code:rounded-6 prose-code:bg-white/6 prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[12px] prose-code:font-normal prose-code:text-white/60 prose-pre:rounded-12 prose-pre:bg-white/4 prose-pre:text-white/60 prose-li:text-white/60 prose-li:marker:text-white/20 prose-th:text-white/50 prose-td:text-white/40 prose-hr:border-white/6'>
				<ReactMarkdown
					remarkPlugins={[remarkGfm, remarkBreaks]}
					disallowedElements={DISALLOWED_ELEMENTS}
					unwrapDisallowed
					components={{
						a: ({children, href, ...props}) => (
							<a {...props} href={href} target='_blank' rel='noopener noreferrer'>
								{children}
							</a>
						),
					}}
				>
					{content}
				</ReactMarkdown>
			</div>
		</div>
	)
}
