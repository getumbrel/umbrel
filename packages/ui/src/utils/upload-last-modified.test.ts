import {expect, test} from 'vitest'

import {uploadLastModified} from './upload-last-modified'

const file = (lastModified: number) => new File(['bytes'], 'photo.jpg', {lastModified})

test('sends the times the server accepts and omits the rest', () => {
	expect(uploadLastModified(file(Date.UTC(2015, 5, 1)))).toBe(Date.UTC(2015, 5, 1))
	expect(uploadLastModified(file(253_402_300_799_999))).toBe(253_402_300_799_999)
	expect(uploadLastModified(file(253_402_300_800_000))).toBeUndefined()
	expect(uploadLastModified(file(0))).toBeUndefined()
	expect(uploadLastModified(file(-86_400_000))).toBeUndefined()
})
