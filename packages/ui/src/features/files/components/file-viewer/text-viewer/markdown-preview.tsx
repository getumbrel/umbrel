import {ImageIcon} from 'lucide-react'
import {createContext, useContext, type ReactNode, type Ref} from 'react'
import ReactMarkdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'

import {safeHref} from '@/features/files/components/file-viewer/shared/links'

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

// Whether what's drawn is inside a link, where a picture's stand-in can't be a link of its own
const InsideLink = createContext(false)

// A link opens only a web page or mail, as every viewer's do. Any other (a path, which would be one on this Umbrel,
// or a place in the file) stays as its words.
function Link({href, title, children}: {href?: string; title?: string; children?: ReactNode}) {
	const safe = safeHref(href)
	if (!safe) return children
	return (
		<a href={safe} title={title} target='_blank' rel='noopener noreferrer'>
			<InsideLink value>{children}</InsideLink>
		</a>
	)
}

// A picture is never fetched: that would tell whoever serves it that the file was opened, when, and from where. Its
// description stands in for it (or where it's kept, when it has none), linked to the picture for a reader who wants
// to see it.
function Picture({src, alt}: {src?: string; alt?: string}) {
	const insideLink = useContext(InsideLink)
	const href = safeHref(src)
	const label = alt || (href && new URL(href).hostname) || src
	if (!label) return null
	const standIn = (
		<>
			<ImageIcon aria-hidden className='mr-[0.3em] inline size-[1em] align-[-0.125em] opacity-70' />
			{label}
		</>
	)
	return href && !insideLink ? <Link href={href}>{standIn}</Link> : standIn
}

interface MarkdownPreviewProps {
	content: string
	// The scrolling element, which find reads and scrolls
	ref?: Ref<HTMLDivElement>
}

// Its words can be selected and copied (the app selects nothing by default),
// which is also what WebKit needs to paint find's highlights. Its whites step up
// with Increase contrast as the app's text does, which the stylesheet can't do
// for typography's variants.
export function MarkdownPreview({content, ref}: MarkdownPreviewProps) {
	return (
		<div ref={ref} className='h-full overflow-auto p-6 select-text'>
			<div className='prose prose-sm max-w-none prose-invert prose-headings:font-semibold prose-headings:-tracking-2 prose-headings:text-white/90 contrast-more:prose-headings:text-white prose-p:text-white/60 contrast-more:prose-p:text-white/85 prose-a:text-white/70 prose-a:underline prose-a:decoration-white/20 hover:prose-a:decoration-white/40 contrast-more:prose-a:text-white contrast-more:prose-a:decoration-white/70 contrast-more:hover:prose-a:decoration-white prose-blockquote:border-white/10 prose-blockquote:text-white/40 contrast-more:prose-blockquote:border-white/40 contrast-more:prose-blockquote:text-white/70 prose-strong:text-white/80 contrast-more:prose-strong:text-white prose-code:rounded-6 prose-code:bg-white/6 prose-code:px-1.5 prose-code:py-0.5 prose-code:text-12 prose-code:font-normal prose-code:text-white/60 contrast-more:prose-code:text-white/85 prose-pre:rounded-12 prose-pre:bg-white/4 prose-pre:text-white/60 contrast-more:prose-pre:text-white/85 prose-li:text-white/60 prose-li:marker:text-white/20 contrast-more:prose-li:text-white/85 contrast-more:prose-li:marker:text-white/70 prose-th:text-white/50 contrast-more:prose-th:text-white/85 prose-td:text-white/40 contrast-more:prose-td:text-white/70 prose-hr:border-white/6 contrast-more:prose-hr:border-white/25'>
				<ReactMarkdown
					remarkPlugins={[remarkGfm, remarkBreaks]}
					disallowedElements={DISALLOWED_ELEMENTS}
					unwrapDisallowed
					components={{a: Link, img: Picture}}
				>
					{content}
				</ReactMarkdown>
			</div>
		</div>
	)
}
