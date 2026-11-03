package com.umbrel.kit

/**
 * The hardware family represented by umbreld's human-readable device model. The same
 * classifier as the Apple apps so a discovered or offline device never renders as a
 * different Umbrel model by accident.
 */
enum class UmbrelDeviceKind {
	HOME,
	PRO,
	ASUS_NUC_14_ESSENTIAL,
	ASUS_NUC_16_PRO,
	ASUS_ROG_NUC_16,
	RASPBERRY_PI,
	GENERIC;

	companion object {
		fun fromModel(model: String?): UmbrelDeviceKind {
			val value = model?.lowercase().orEmpty()
			return when {
				"umbrel home" in value -> HOME
				"umbrel pro" in value -> PRO
				"asus nuc 14 essential" in value -> ASUS_NUC_14_ESSENTIAL
				"asus nuc 16 pro" in value -> ASUS_NUC_16_PRO
				"asus rog nuc 16" in value -> ASUS_ROG_NUC_16
				"raspberry pi" in value -> RASPBERRY_PI
				else -> GENERIC
			}
		}
	}
}
