// Shared connection and security model for the Android app: discovery, pinned local
// HTTPS, native sessions, saved devices, Keystore-sealed secrets, and the photo backup
// engine. A Kotlin port of clients/apple/UmbrelKit with the same server contract.
plugins {
	alias(libs.plugins.android.library)
	alias(libs.plugins.kotlin.serialization)
}

android {
	namespace = "com.umbrel.kit"
	// Compose 1.12+ requires compileSdk 37. targetSdk stays 36: targeting 37 turns on the
	// local-network runtime permission, which needs its own onboarding work.
	compileSdk = 37

	defaultConfig {
		// Android 11: MediaStore generation-based change tracking (API 30) and
		// IS_TRASHED filtering are the documented mechanisms the backup ledger relies on.
		minSdk = 30
		consumerProguardFiles("consumer-rules.pro")
	}

	buildTypes {
		release {
			isMinifyEnabled = false
		}
	}

	compileOptions {
		sourceCompatibility = JavaVersion.VERSION_17
		targetCompatibility = JavaVersion.VERSION_17
	}

	testOptions {
		unitTests {
			isIncludeAndroidResources = true
			// Robolectric's documented flags for running on Java 17 and later.
			all {
				it.jvmArgs(
					"--add-opens=java.base/java.lang=ALL-UNNAMED",
					"--add-opens=java.base/java.util=ALL-UNNAMED",
					"--add-opens=java.base/java.io=ALL-UNNAMED",
					"--add-opens=java.base/java.net=ALL-UNNAMED",
					"--add-opens=java.base/java.security=ALL-UNNAMED",
					"--add-opens=java.base/java.text=ALL-UNNAMED",
					"--add-opens=java.base/jdk.internal.access=ALL-UNNAMED",
					"--add-opens=java.desktop/java.awt.font=ALL-UNNAMED",
					"--add-opens=jdk.compiler/com.sun.tools.javac.api=ALL-UNNAMED",
				)
			}
		}
	}
}

// Java 21 because Robolectric needs it to run unit tests against Android 15 (API 35) and
// later. The bytecode target stays 17 (compileOptions above).
java {
	toolchain {
		languageVersion = JavaLanguageVersion.of(21)
	}
}

dependencies {
	implementation(libs.kotlinx.coroutines.android)
	implementation(libs.kotlinx.serialization.json)
	implementation(libs.androidx.core.ktx)
	implementation(libs.androidx.work.runtime)
	implementation(libs.androidx.sqlite)
	implementation(libs.androidx.sqlite.framework)
	implementation(libs.okhttp)
	implementation(libs.okhttp.coroutines)

	testImplementation(libs.junit)
	testImplementation(libs.robolectric)
	testImplementation(libs.kotlinx.coroutines.test)
	testImplementation(libs.okhttp.mockwebserver)
	testImplementation(libs.okhttp.tls)
	testImplementation(libs.androidx.test.ext.junit)
	testImplementation(libs.androidx.work.testing)
}
