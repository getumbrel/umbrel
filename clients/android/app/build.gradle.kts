plugins {
	alias(libs.plugins.android.application)
	alias(libs.plugins.compose.compiler)
	alias(libs.plugins.kotlin.serialization)
}

android {
	namespace = "com.umbrel.android"
	// Compose 1.12+ requires compileSdk 37. targetSdk stays 36: targeting 37 turns on the
	// local-network runtime permission, which needs its own onboarding work.
	compileSdk = 37

	defaultConfig {
		applicationId = "com.umbrel.android"
		minSdk = 30
		// Google Play requires new apps and updates to target Android 16 (API 36).
		targetSdk = 36
		// versionCode is the build number (CURRENT_PROJECT_VERSION on Apple); versionName is
		// the marketing version. Increment versionCode for every Play upload.
		versionCode = 4
		versionName = "0.1"
		testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
	}

	// Release builds are signed with the Play upload key when UMBREL_UPLOAD_KEYSTORE and
	// UMBREL_UPLOAD_KEY_PASSWORD are set (see README "Release"). Without them the bundle is
	// unsigned, which Play rejects.
	val uploadKeystore = System.getenv("UMBREL_UPLOAD_KEYSTORE")
	signingConfigs {
		if (uploadKeystore != null) {
			create("upload") {
				storeFile = file(uploadKeystore)
				storePassword = System.getenv("UMBREL_UPLOAD_KEY_PASSWORD")
				keyAlias = "upload"
				keyPassword = storePassword
			}
		}
	}

	buildTypes {
		debug {
			applicationIdSuffix = ".dev"
			versionNameSuffix = "-dev"
		}
		release {
			if (uploadKeystore != null) signingConfig = signingConfigs.getByName("upload")
			isMinifyEnabled = true
			isShrinkResources = true
			proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
		}
	}

	buildFeatures {
		compose = true
		buildConfig = true
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
	implementation(project(":umbrelkit"))

	val composeBom = platform(libs.compose.bom)
	implementation(composeBom)
	androidTestImplementation(composeBom)
	implementation(libs.compose.ui)
	implementation(libs.compose.ui.graphics)
	implementation(libs.compose.foundation)
	implementation(libs.compose.material3)
	implementation(libs.compose.ui.tooling.preview)
	debugImplementation(libs.compose.ui.tooling)
	debugImplementation(libs.compose.ui.test.manifest)

	implementation(libs.androidx.core.ktx)
	implementation(libs.androidx.splashscreen)
	implementation(libs.androidx.activity.compose)
	implementation(libs.androidx.lifecycle.runtime.compose)
	implementation(libs.androidx.lifecycle.viewmodel.compose)
	implementation(libs.androidx.lifecycle.process)
	implementation(libs.androidx.browser)
	implementation(libs.androidx.webkit)
	implementation(libs.androidx.work.runtime)
	implementation(libs.kotlinx.coroutines.android)
	implementation(libs.kotlinx.serialization.json)
	implementation(libs.okhttp)
	implementation(libs.coil.compose)
	implementation(libs.coil.network.okhttp)
	implementation(libs.coil.svg)
	implementation(libs.coil.video)
	implementation(libs.backdrop)
	implementation(libs.androidx.exifinterface)
	implementation(libs.media3.exoplayer)
	implementation(libs.media3.ui)

	testImplementation(libs.junit)
	testImplementation(libs.robolectric)
	testImplementation(libs.kotlinx.coroutines.test)
	testImplementation(libs.graalvm.polyglot)
	testImplementation(libs.graalvm.js)
	androidTestImplementation(libs.androidx.test.ext.junit)
	androidTestImplementation(libs.androidx.test.espresso.core)
	androidTestImplementation(libs.compose.ui.test.junit4)
}
