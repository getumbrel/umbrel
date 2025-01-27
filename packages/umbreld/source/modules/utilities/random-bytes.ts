import crypto from 'node:crypto'
import {promisify} from 'node:util'

const randomBytes = promisify(crypto.randomBytes)

export default randomBytes
