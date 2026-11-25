// `hash` versions each wallpaper's files, which are served under fixed names with
// a year-long immutable cache policy. It's the first 12 hex digits of the SHA-256
// of the JPEG followed by the large, medium, small and thumbnail AVIFs; the unit
// test recomputes it and prints the new value when a file changes.
export const wallpapers = [
	{id: '1', brandColorHsl: '259 100% 59%', hash: '6dde3782a1d9'},
	{id: '2', brandColorHsl: '6 56% 54%', hash: '806c6e2a8141'},
	{id: '3', brandColorHsl: '22 88% 40%', hash: 'b334c12b0f3f'},
	{id: '4', brandColorHsl: '198 100% 31%', hash: 'a1b12d75f379'},
	{id: '5', brandColorHsl: '202 100% 33%', hash: '77c786fd261a'},
	{id: '6', brandColorHsl: '160 100% 27%', hash: 'a0122a49ddd4'},
	{id: '7', brandColorHsl: '79 100% 25%', hash: '4119710bfd96'},
	{id: '8', brandColorHsl: '185 100% 29%', hash: '9593f1fbfbfc'},
	{id: '9', brandColorHsl: '359 64% 62%', hash: 'f2c1aea7edcd'},
	{id: '10', brandColorHsl: '18 75% 52%', hash: 'cb9e4c1d49af'},
	{id: '11', brandColorHsl: '185 100% 29%', hash: '88c98a4468c3'},
	{id: '12', brandColorHsl: '332 84% 47%', hash: '3022530435ba'},
	{id: '13', brandColorHsl: '194 81% 39%', hash: '73754ee67afe'},
	{id: '14', brandColorHsl: '328 87% 49%', hash: '98fbd60150b2'},
	{id: '15', brandColorHsl: '32 100% 36%', hash: '1697a19a4044'},
	{id: '16', brandColorHsl: '265 100% 42%', hash: '0b4afbe88129'},
	{id: '17', brandColorHsl: '184 100% 25%', hash: 'd1e4ce262086'},
	{id: '18', brandColorHsl: '259 100% 59%', hash: 'c5b16898d6af'},
	{id: '19', brandColorHsl: '204 100% 41%', hash: 'ec611206bbd9'},
	{id: '20', brandColorHsl: '259 100% 59%', hash: '0f899751e7ac'},
	{id: '21', brandColorHsl: '12 78% 50%', hash: 'bf939945002c'},
	{id: '22', brandColorHsl: '92 52% 41%', hash: '9a9260980de8'},
	{id: '23', brandColorHsl: '24 90% 50%', hash: 'd9c1579f1571'},
	{id: '24', brandColorHsl: '209 85% 42%', hash: 'cc8585be71c2'},
	{id: '25', brandColorHsl: '174 75% 32%', hash: 'e552ff2c1257'},
] as const

export type Wallpaper = (typeof wallpapers)[number]
export type WallpaperId = Wallpaper['id']
export type WallpaperAppearance = Pick<Wallpaper, 'id' | 'brandColorHsl' | 'hash'>

export const defaultWallpaperId: WallpaperId = '23'

export const wallpapersKeyed = Object.fromEntries(wallpapers.map((wallpaper) => [wallpaper.id, wallpaper])) as Record<
	WallpaperId,
	Wallpaper
>

export const wallpaperIds = wallpapers.map((wallpaper) => wallpaper.id)

export function isWallpaperId(id: string): id is WallpaperId {
	return Object.hasOwn(wallpapersKeyed, id)
}

export function resolveWallpaper(id?: string): Wallpaper {
	if (!id || !isWallpaperId(id)) return wallpapersKeyed[defaultWallpaperId]
	return wallpapersKeyed[id]
}

export function resolveWallpaperAppearance(id?: string): WallpaperAppearance {
	const {id: resolvedId, brandColorHsl, hash} = resolveWallpaper(id)
	return {id: resolvedId, brandColorHsl, hash}
}
