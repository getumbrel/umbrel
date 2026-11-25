import {tw} from '@/utils/tw'

// The words a search found an item by, marked wherever the whole of its text
// is shown — a photo's words in the inspector — as a highlighter would: the
// match colour behind dark text (see --color-match in index.css)
export const markClass = tw`rounded-[3px] bg-match px-[2px] box-decoration-clone text-match-ink`
