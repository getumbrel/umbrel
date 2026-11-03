package com.umbrel.android.main

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import coil3.compose.LocalPlatformContext
import coil3.request.ImageRequest
import coil3.request.crossfade
import com.umbrel.android.R
import okhttp3.Interceptor
import okhttp3.Response
import okhttp3.ResponseBody.Companion.asResponseBody
import okio.Buffer
import okio.ForwardingSource
import okio.buffer
import java.io.IOException
import java.net.URI
import java.net.URISyntaxException
import kotlin.math.min

/**
 * App icons are external URLs from app manifests. Only plain HTTPS URLs without embedded
 * credentials are fetched; anything else shows the placeholder.
 */
fun appIconUrl(icon: String?): String? {
	val uri = try {
		URI(icon ?: return null)
	} catch (error: URISyntaxException) {
		return null
	}
	if (!uri.scheme.equals("https", ignoreCase = true) || uri.host.isNullOrEmpty() || uri.rawUserInfo != null) return null
	return icon
}

/**
 * Bounds an untrusted icon response. The largest first-party gallery icon is about 3.3 MB,
 * so 4 MB keeps legitimate icons working.
 */
object IconResponseLimit : Interceptor {
	const val MAXIMUM_BYTES = 4L * 1024 * 1024

	override fun intercept(chain: Interceptor.Chain): Response {
		val response = chain.proceed(chain.request())
		val body = response.body
		if (body.contentLength() > MAXIMUM_BYTES) {
			response.close()
			throw IOException("Icon response is larger than $MAXIMUM_BYTES bytes")
		}
		val limited = object : ForwardingSource(body.source()) {
			private var total = 0L

			override fun read(sink: Buffer, byteCount: Long): Long {
				val read = super.read(sink, byteCount)
				if (read > 0) {
					total += read
					if (total > MAXIMUM_BYTES) throw IOException("Icon response is larger than $MAXIMUM_BYTES bytes")
				}
				return read
			}
		}
		return response.newBuilder().body(limited.buffer().asResponseBody(body.contentType(), body.contentLength())).build()
	}
}

/**
 * A rounded app icon: the umbrelOS placeholder until the SVG or raster icon decodes, then
 * a short fade. Coil caches decoded icons in memory and on disk, so later appearances are
 * instant.
 */
@Composable
fun AppIconView(url: String?, modifier: Modifier = Modifier, size: Dp = 50.dp, corner: Dp = 12.5.dp, colorFilter: ColorFilter? = null) {
	val context = LocalPlatformContext.current
	val placeholder = painterResource(R.drawable.app_icon_placeholder)
	val request = remember(url, context) {
		appIconUrl(url)?.let { ImageRequest.Builder(context).data(it).crossfade(250).build() }
	}
	AsyncImage(
		model = request,
		contentDescription = null,
		placeholder = placeholder,
		error = placeholder,
		fallback = placeholder,
		contentScale = ContentScale.Crop,
		colorFilter = colorFilter,
		modifier = modifier.size(size).clip(RoundedCornerShape(corner)),
	)
}

/**
 * The umbrelOS folder icon recoloured to the wallpaper's brand colour, drawn from the same
 * paths umbrelOS uses so folders match the dashboard for any wallpaper. The glyph's
 * embossing filters are not drawn; the glyph is the flat 30% black fill underneath them.
 */
@Composable
fun FolderIconView(path: String, brandColor: Color, modifier: Modifier = Modifier) {
	val glyph = FolderArt.glyphs[path.substringAfterLast('/')]
	Canvas(modifier) {
		val scale = min(size.width / FolderArt.WIDTH, size.height / FolderArt.HEIGHT)
		translate((size.width - FolderArt.WIDTH * scale) / 2, (size.height - FolderArt.HEIGHT * scale) / 2) {
			scale(scale, scale, pivot = Offset.Zero) {
				drawPath(FolderArt.insertBack, Color.White.copy(alpha = 0.6f))
				drawPath(FolderArt.insertFront, Color.White)
				drawPath(FolderArt.body, brandColor)
				drawPath(
					FolderArt.body,
					Brush.verticalGradient(
						0.315f to Color.Black.copy(alpha = 0f),
						0.965f to Color.Black.copy(alpha = 0.48f),
						startY = 0f,
						endY = FolderArt.HEIGHT,
					),
				)
				if (glyph != null) {
					// umbrelOS places the glyph at 23% left, 28% top, sized 56% of the folder,
					// fitted inside that box and centred.
					val glyphScale = min(GLYPH_WIDTH / glyph.viewBoxWidth, GLYPH_HEIGHT / glyph.viewBoxHeight)
					translate(
						GLYPH_X + (GLYPH_WIDTH - glyph.viewBoxWidth * glyphScale) / 2,
						GLYPH_Y + (GLYPH_HEIGHT - glyph.viewBoxHeight * glyphScale) / 2,
					) {
						scale(glyphScale, glyphScale, pivot = Offset.Zero) {
							drawPath(glyph.path, Color.Black.copy(alpha = 0.3f))
						}
					}
				}
			}
		}
	}
}

private const val GLYPH_X = 13.11f
private const val GLYPH_Y = 14f
private const val GLYPH_WIDTH = 31.92f
private const val GLYPH_HEIGHT = 28f
