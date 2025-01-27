import {ImgHTMLAttributes} from 'react'

import zipIcon from './zip.svg'

// TODO: Update with actual SVG once images are removed from the zip icon
const SvgZip = (props: ImgHTMLAttributes<HTMLImageElement>) => <img src={zipIcon} alt='ZIP File' {...props} />

export default SvgZip
