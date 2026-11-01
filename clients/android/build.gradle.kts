// AGP 9 compiles Kotlin through its built-in Kotlin support, so the
// org.jetbrains.kotlin.android plugin is deliberately not applied.
plugins {
	alias(libs.plugins.android.application) apply false
	alias(libs.plugins.android.library) apply false
	alias(libs.plugins.compose.compiler) apply false
	alias(libs.plugins.kotlin.serialization) apply false
}
