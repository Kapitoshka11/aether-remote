plugins {
  alias(libs.plugins.android.application)
  alias(libs.plugins.kotlin.compose)
  alias(libs.plugins.google.devtools.ksp)
  alias(libs.plugins.roborazzi)
}

val accountRelayUrl = providers.gradleProperty("aetherAccountRelayUrl")
  .orElse(providers.environmentVariable("AETHER_ACCOUNT_RELAY_URL"))
  .getOrElse("wss://aether-account-relay.akulenoklaha.workers.dev")
  .trim()
val escapedAccountRelayUrl = accountRelayUrl.replace("\\", "\\\\").replace("\"", "\\\"")

android {
  namespace = "com.example"
  compileSdk { version = release(36) { minorApiLevel = 1 } }

  defaultConfig {
    applicationId = "com.aether.remote"
    minSdk = 24
    targetSdk = 36
    versionCode = 28
    versionName = "2.5.1"
    buildConfigField("String", "ACCOUNT_RELAY_URL", "\"$escapedAccountRelayUrl\"")

    testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
  }

  signingConfigs {
    create("release") {
      val keystorePath = System.getenv("KEYSTORE_PATH")
      val storeSecret = System.getenv("STORE_PASSWORD")
      val alias = System.getenv("KEY_ALIAS")
      val keySecret = System.getenv("KEY_PASSWORD")
      val releaseRequested = gradle.startParameter.taskNames.any { it.contains("release", ignoreCase = true) }
      if (releaseRequested && listOf(keystorePath, storeSecret, alias, keySecret).any { it.isNullOrBlank() }) {
        throw GradleException("Release signing requires KEYSTORE_PATH, STORE_PASSWORD, KEY_ALIAS and KEY_PASSWORD environment variables")
      }
      if (!keystorePath.isNullOrBlank()) storeFile = file(keystorePath)
      storePassword = storeSecret
      keyAlias = alias
      keyPassword = keySecret
    }
  }

  buildTypes {
    release {
      isCrunchPngs = false
      isMinifyEnabled = true
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
      signingConfig = signingConfigs.getByName("release")
    }
    debug { }
  }
  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_11
    targetCompatibility = JavaVersion.VERSION_11
  }
  buildFeatures {
    compose = true
    buildConfig = true
  }
  testOptions { unitTests { isIncludeAndroidResources = true } }
  dependenciesInfo {
    includeInApk = false
    includeInBundle = true
  }
  lint {
    abortOnError = true
    checkReleaseBuilds = true
  }
}

dependencies {
  implementation(platform(libs.androidx.compose.bom))
  implementation(libs.androidx.activity.compose)
  implementation(libs.androidx.compose.material.icons.core)
  implementation(libs.androidx.compose.material.icons.extended)
  implementation(libs.androidx.compose.material3)
  implementation(libs.androidx.compose.ui)
  implementation(libs.androidx.compose.ui.graphics)
  implementation(libs.androidx.compose.ui.tooling.preview)
  implementation(libs.androidx.core.ktx)
  implementation(libs.coil.compose)
  implementation(libs.coil.gif)
  implementation(libs.coil.svg)
  implementation(libs.androidx.lifecycle.runtime.compose)
  implementation(libs.androidx.lifecycle.runtime.ktx)
  implementation(libs.androidx.lifecycle.viewmodel.compose)
  implementation(libs.androidx.room.ktx)
  implementation(libs.androidx.room.runtime)
  implementation(libs.converter.moshi)
  implementation(libs.kotlinx.coroutines.android)
  implementation(libs.kotlinx.coroutines.core)
  implementation(libs.logging.interceptor)
  implementation(libs.moshi.kotlin)
  implementation(libs.okhttp)
  compileOnly("com.google.errorprone:error_prone_annotations:2.36.0")
  implementation("androidx.security:security-crypto:1.1.0")
  implementation("com.journeyapps:zxing-android-embedded:4.3.0")
  implementation(libs.retrofit)
  testImplementation(libs.androidx.compose.ui.test.junit4)
  testImplementation(libs.androidx.core)
  testImplementation(libs.androidx.junit)
  testImplementation(libs.junit)
  testImplementation(libs.kotlinx.coroutines.test)
  testImplementation(libs.robolectric)
  testImplementation(libs.roborazzi)
  testImplementation(libs.roborazzi.compose)
  testImplementation(libs.roborazzi.junit.rule)
  androidTestImplementation(platform(libs.androidx.compose.bom))
  androidTestImplementation(libs.androidx.compose.ui.test.junit4)
  androidTestImplementation(libs.androidx.espresso.core)
  androidTestImplementation(libs.androidx.junit)
  androidTestImplementation(libs.androidx.runner)
  debugImplementation(libs.androidx.compose.ui.test.manifest)
  debugImplementation(libs.androidx.compose.ui.tooling)
  "ksp"(libs.androidx.room.compiler)
  "ksp"(libs.moshi.kotlin.codegen)
}
