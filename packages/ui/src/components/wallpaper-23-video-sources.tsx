import largeAv1 from '@/assets/wallpaper-23/wallpaper-23-large-av1.webm'
import largeVp9 from '@/assets/wallpaper-23/wallpaper-23-large-vp9.webm'
import largeH264 from '@/assets/wallpaper-23/wallpaper-23-large.mp4'
import mediumAv1 from '@/assets/wallpaper-23/wallpaper-23-medium-av1.webm'
import mediumVp9 from '@/assets/wallpaper-23/wallpaper-23-medium-vp9.webm'
import mediumH264 from '@/assets/wallpaper-23/wallpaper-23-medium.mp4'

// Shared by onboarding and the selected wallpaper. Let the browser exhaust this
// ordered list: Safari may reject WebM candidates before successfully loading H.264.
//
// VP9 is listed before AV1 on purpose. Browsers report AV1 as playable even where
// they can only decode it in software (Chrome on M1/M2 Macs and most Intel-era
// machines), which costs ~35% of a CPU core for as long as the wallpaper plays,
// while every device with an AV1 decoder also decodes VP9 in hardware. The VP9
// files are ~20% larger, a one-time cached download.
//
// The 2880×1620 tier is for viewports that can show it: a ≥1200px window on a
// HiDPI display, or a ≥2000px window on any display. A 1080p monitor gets the
// 1920×1080 tier instead of decoding 2.25× the pixels it can paint.
export function Wallpaper23VideoSources() {
	return (
		<>
			<source
				media='(min-width: 1200px) and (-webkit-min-device-pixel-ratio: 1.5), (min-width: 1200px) and (min-resolution: 1.5dppx), (min-width: 2000px)'
				src={largeVp9}
				type='video/webm; codecs="vp9"'
			/>
			<source
				media='(min-width: 1200px) and (-webkit-min-device-pixel-ratio: 1.5), (min-width: 1200px) and (min-resolution: 1.5dppx), (min-width: 2000px)'
				src={largeAv1}
				type='video/webm; codecs="av01.0.12M.08"'
			/>
			<source
				media='(min-width: 1200px) and (-webkit-min-device-pixel-ratio: 1.5), (min-width: 1200px) and (min-resolution: 1.5dppx), (min-width: 2000px)'
				src={largeH264}
				type='video/mp4; codecs="avc1.640033"'
			/>
			<source src={mediumVp9} type='video/webm; codecs="vp9"' />
			<source src={mediumAv1} type='video/webm; codecs="av01.0.08M.08"' />
			<source src={mediumH264} type='video/mp4; codecs="avc1.640029"' />
		</>
	)
}
