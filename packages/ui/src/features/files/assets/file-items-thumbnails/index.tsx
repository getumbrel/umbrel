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

type ThumbnailProps = React.ImgHTMLAttributes<HTMLImageElement>

export const AiThumbnail: React.FC<ThumbnailProps> = (props): JSX.Element => (
	<img src={aiWebp} {...props} style={{objectFit: 'contain'}} />
)
export const AudioThumbnail: React.FC<ThumbnailProps> = (props): JSX.Element => (
	<img src={audioWebp} {...props} style={{objectFit: 'contain'}} />
)
export const CsvThumbnail: React.FC<ThumbnailProps> = (props): JSX.Element => (
	<img src={csvWebp} {...props} style={{objectFit: 'contain'}} />
)
export const DmgThumbnail: React.FC<ThumbnailProps> = (props): JSX.Element => (
	<img src={dmgWebp} {...props} style={{objectFit: 'contain'}} />
)
export const DocxThumbnail: React.FC<ThumbnailProps> = (props): JSX.Element => (
	<img src={docxWebp} {...props} style={{objectFit: 'contain'}} />
)
export const EbookThumbnail: React.FC<ThumbnailProps> = (props): JSX.Element => (
	<img src={ebookWebp} {...props} style={{objectFit: 'contain'}} />
)
export const ExeThumbnail: React.FC<ThumbnailProps> = (props): JSX.Element => (
	<img src={exeWebp} {...props} style={{objectFit: 'contain'}} />
)
export const ImageThumbnail: React.FC<ThumbnailProps> = (props): JSX.Element => (
	<img src={imageWebp} {...props} style={{objectFit: 'contain'}} />
)
export const IsoThumbnail: React.FC<ThumbnailProps> = (props): JSX.Element => (
	<img src={isoWebp} {...props} style={{objectFit: 'contain'}} />
)
export const PdfThumbnail: React.FC<ThumbnailProps> = (props): JSX.Element => (
	<img src={pdfWebp} {...props} style={{objectFit: 'contain'}} />
)
export const PptThumbnail: React.FC<ThumbnailProps> = (props): JSX.Element => (
	<img src={pptWebp} {...props} style={{objectFit: 'contain'}} />
)
export const PsdThumbnail: React.FC<ThumbnailProps> = (props): JSX.Element => (
	<img src={psdWebp} {...props} style={{objectFit: 'contain'}} />
)
export const TxtThumbnail: React.FC<ThumbnailProps> = (props): JSX.Element => (
	<img src={txtWebp} {...props} style={{objectFit: 'contain'}} />
)
export const UnknownThumbnail: React.FC<ThumbnailProps> = (props): JSX.Element => (
	<img src={unknownWebp} {...props} style={{objectFit: 'contain'}} />
)
export const VideoThumbnail: React.FC<ThumbnailProps> = (props): JSX.Element => (
	<img src={videoWebp} {...props} style={{objectFit: 'contain'}} />
)
export const ZipThumbnail: React.FC<ThumbnailProps> = (props): JSX.Element => (
	<img src={zipWebp} {...props} style={{objectFit: 'contain'}} />
)
