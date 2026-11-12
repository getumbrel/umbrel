import React from 'react'

// We convert the SVG sources to the WebP format at build
// time using `vite-imagetools`. This ensures the thumbnails are lightweight
// rasters, and don't affect performance when browsing large directories.

import aiWebp from './ai.svg?w=120&format=webp&imagetools'
import audioWebp from './audio.svg?w=120&format=webp&imagetools'
import csvWebp from './csv.svg?w=120&format=webp&imagetools'
import dmgWebp from './dmg.svg?w=120&format=webp&imagetools'
import docxWebp from './docx.svg?w=120&format=webp&imagetools'
import ebookWebp from './ebook.svg?w=120&format=webp&imagetools'
import exeWebp from './exe.svg?w=120&format=webp&imagetools'
import imageWebp from './image.svg?w=120&format=webp&imagetools'
import isoWebp from './iso.svg?w=120&format=webp&imagetools'
import pdfWebp from './pdf.svg?w=120&format=webp&imagetools'
import pptWebp from './ppt.svg?w=120&format=webp&imagetools'
import psdWebp from './psd.svg?w=120&format=webp&imagetools'
import txtWebp from './txt.svg?w=120&format=webp&imagetools'
import unknownWebp from './unknown.svg?w=120&format=webp&imagetools'
import videoWebp from './video.svg?w=120&format=webp&imagetools'
import zipWebp from './zip.svg?w=120&format=webp&imagetools'

// Decorative by default: the file's name is next to its icon
type ThumbnailProps = React.ImgHTMLAttributes<HTMLImageElement>

export const AiThumbnail: React.FC<ThumbnailProps> = (props) => (
	<img src={aiWebp} alt='' {...props} style={{objectFit: 'contain'}} />
)
export const AudioThumbnail: React.FC<ThumbnailProps> = (props) => (
	<img src={audioWebp} alt='' {...props} style={{objectFit: 'contain'}} />
)
export const CsvThumbnail: React.FC<ThumbnailProps> = (props) => (
	<img src={csvWebp} alt='' {...props} style={{objectFit: 'contain'}} />
)
export const DmgThumbnail: React.FC<ThumbnailProps> = (props) => (
	<img src={dmgWebp} alt='' {...props} style={{objectFit: 'contain'}} />
)
export const DocxThumbnail: React.FC<ThumbnailProps> = (props) => (
	<img src={docxWebp} alt='' {...props} style={{objectFit: 'contain'}} />
)
export const EbookThumbnail: React.FC<ThumbnailProps> = (props) => (
	<img src={ebookWebp} alt='' {...props} style={{objectFit: 'contain'}} />
)
export const ExeThumbnail: React.FC<ThumbnailProps> = (props) => (
	<img src={exeWebp} alt='' {...props} style={{objectFit: 'contain'}} />
)
export const ImageThumbnail: React.FC<ThumbnailProps> = (props) => (
	<img src={imageWebp} alt='' {...props} style={{objectFit: 'contain'}} />
)
export const IsoThumbnail: React.FC<ThumbnailProps> = (props) => (
	<img src={isoWebp} alt='' {...props} style={{objectFit: 'contain'}} />
)
export const PdfThumbnail: React.FC<ThumbnailProps> = (props) => (
	<img src={pdfWebp} alt='' {...props} style={{objectFit: 'contain'}} />
)
export const PptThumbnail: React.FC<ThumbnailProps> = (props) => (
	<img src={pptWebp} alt='' {...props} style={{objectFit: 'contain'}} />
)
export const PsdThumbnail: React.FC<ThumbnailProps> = (props) => (
	<img src={psdWebp} alt='' {...props} style={{objectFit: 'contain'}} />
)
export const TxtThumbnail: React.FC<ThumbnailProps> = (props) => (
	<img src={txtWebp} alt='' {...props} style={{objectFit: 'contain'}} />
)
export const UnknownThumbnail: React.FC<ThumbnailProps> = (props) => (
	<img src={unknownWebp} alt='' {...props} style={{objectFit: 'contain'}} />
)
export const VideoThumbnail: React.FC<ThumbnailProps> = (props) => (
	<img src={videoWebp} alt='' {...props} style={{objectFit: 'contain'}} />
)
export const ZipThumbnail: React.FC<ThumbnailProps> = (props) => (
	<img src={zipWebp} alt='' {...props} style={{objectFit: 'contain'}} />
)
