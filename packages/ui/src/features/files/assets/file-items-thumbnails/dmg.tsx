import {ImgHTMLAttributes} from 'react'

import dmgIcon from './dmg.svg'

// TODO: Update with actual SVG once images are removed from the dmg icon
const SvgDmg = (props: ImgHTMLAttributes<HTMLImageElement>) => <img src={dmgIcon} alt='Disk Image' {...props} />

export default SvgDmg
