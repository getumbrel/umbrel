package com.umbrel.android.main

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import java.util.Locale

/** The Info card's lines read as the iOS app writes them for the same photo. */
class PhotoViewerMetadataTest {
	private val locale = Locale.getDefault()

	@Before
	fun useUsNumbers() = Locale.setDefault(Locale.US)

	@After
	fun restoreLocale() = Locale.setDefault(locale)

	@Test
	fun theMakeIsLeftOutWhenTheModelAlreadyNamesIt() {
		assertEquals("NIKON D800E", PhotoViewerMetadata.cameraName("NIKON CORPORATION", "NIKON D800E"))
		assertEquals("Apple iPhone X", PhotoViewerMetadata.cameraName("Apple", "iPhone X"))
		assertEquals("Pixel 8a", PhotoViewerMetadata.cameraName(null, "Pixel 8a"))
		assertNull(PhotoViewerMetadata.cameraName("Apple", null))
	}

	@Test
	fun anIPhoneCameraIsToldByItsLensNotItsZoom() {
		assertEquals("Front Camera", PhotoViewerMetadata.iPhoneCamera("iPhone X front TrueDepth camera 2.87mm f/2.2", 2.87, emptyList()))
		assertEquals("Main Camera", PhotoViewerMetadata.iPhoneCamera("iPhone 8 back camera 3.99mm f/1.8", 3.99, emptyList()))
		val dual = listOf(4.0, 6.0, 1.8, 2.4)
		assertEquals("Telephoto Camera", PhotoViewerMetadata.iPhoneCamera("iPhone X back dual camera 6mm f/2.4", 6.0, dual))
		assertEquals("Main Camera", PhotoViewerMetadata.iPhoneCamera("iPhone X back dual camera 4mm f/1.8", 4.0, dual))
		val triple = listOf(1.54, 6.0, 1.8, 2.4)
		assertEquals("Ultra Wide Camera", PhotoViewerMetadata.iPhoneCamera("iPhone 11 Pro back triple camera 1.54mm f/2.4", 1.54, triple))
		assertEquals("Main Camera", PhotoViewerMetadata.iPhoneCamera("iPhone 11 Pro back triple camera 4.25mm f/1.8", 4.25, triple))
		assertNull(PhotoViewerMetadata.iPhoneCamera("iPhone X back dual camera 6mm f/2.4", 6.0, emptyList()))
	}

	@Test
	fun sizesAndExposureAreWrittenAsPhotosWritesThem() {
		assertEquals("6 MP", PhotoViewerMetadata.megapixelsText(3000, 2002))
		assertEquals("0.1 MP", PhotoViewerMetadata.megapixelsText(356, 356))
		assertNull(PhotoViewerMetadata.megapixelsText(0, 0))
		assertEquals("22 KB", PhotoViewerMetadata.fileSizeText(22_100))
		assertEquals("1.9 MB", PhotoViewerMetadata.fileSizeText(1_852_262))
		assertEquals("1.25 GB", PhotoViewerMetadata.fileSizeText(1_250_000_000))
		assertEquals("20.0 s", PhotoViewerMetadata.shutterText(20.0))
		assertEquals("1/209 s", PhotoViewerMetadata.shutterText(1 / 209.0))
	}
}
