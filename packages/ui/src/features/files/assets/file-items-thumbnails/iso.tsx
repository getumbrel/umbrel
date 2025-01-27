import {ImgHTMLAttributes} from 'react'

import isoIcon from './iso.svg'

// TODO: Update with actual SVG once images are removed from the iso icon
const SvgIso = (props: ImgHTMLAttributes<HTMLImageElement>) => <img src={isoIcon} alt='ISO Image' {...props} />

export default SvgIso
