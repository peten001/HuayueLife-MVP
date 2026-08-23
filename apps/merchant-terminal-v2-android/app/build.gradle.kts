import org.gradle.api.GradleException
import org.gradle.api.provider.Provider

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.kapt")
    id("org.jetbrains.kotlin.plugin.compose")
}

fun configValue(
    propertyName: String,
    environmentName: String,
    fallback: String,
): Provider<String> = providers.gradleProperty(propertyName)
    .orElse(providers.environmentVariable(environmentName))
    .orElse(fallback)

fun String.asBuildConfigString(): String =
    "\"${replace("\\", "\\\\").replace("\"", "\\\"")}\""

val terminalVersionCode = 64
val terminalVersionName = "2.0.0-rc13"

val debugCashierWebUrl = configValue(
    "cashierWebUrlDebug",
    "CASHIER_WEB_URL_DEBUG",
    "https://cashier.huayueyouxuan.com/",
)
val debugTrustedPageOrigin = configValue(
    "trustedPageOriginDebug",
    "TRUSTED_PAGE_ORIGIN_DEBUG",
    "https://cashier.huayueyouxuan.com",
)
val debugTrustedResourceHosts = configValue(
    "trustedResourceHostsDebug",
    "TRUSTED_RESOURCE_HOSTS_DEBUG",
    "api.huayueyouxuan.com",
)
val debugConnectorApiBaseUrl = configValue(
    "connectorApiBaseUrlDebug",
    "CONNECTOR_API_BASE_URL_DEBUG",
    "",
)
val buildRevision = configValue("buildRevision", "BUILD_REVISION", "local-build")

val releaseSigning = mapOf(
    "storeFile" to configValue(
        "yunqiaoReleaseStoreFile",
        "YUNQIAO_RELEASE_STORE_FILE",
        "",
    ),
    "storePassword" to configValue(
        "yunqiaoReleaseStorePassword",
        "YUNQIAO_RELEASE_STORE_PASSWORD",
        "",
    ),
    "keyAlias" to configValue(
        "yunqiaoReleaseKeyAlias",
        "YUNQIAO_RELEASE_KEY_ALIAS",
        "",
    ),
    "keyPassword" to configValue(
        "yunqiaoReleaseKeyPassword",
        "YUNQIAO_RELEASE_KEY_PASSWORD",
        "",
    ),
)
val hasAnyReleaseSigningValue = releaseSigning.values.any { !it.orNull.isNullOrBlank() }
val hasCompleteReleaseSigning = releaseSigning.values.all { !it.orNull.isNullOrBlank() }

check(!hasAnyReleaseSigningValue || hasCompleteReleaseSigning) {
    "Release signing is partially configured. Provide all four YUNQIAO_RELEASE_* values."
}

android {
    namespace = "com.yunqiao.life.merchantterminal"
    compileSdk = 35
    buildToolsVersion = "35.0.0"

    defaultConfig {
        applicationId = "com.yunqiao.life.merchantterminal"
        minSdk = 26
        targetSdk = 35
        versionCode = terminalVersionCode
        versionName = terminalVersionName

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables.useSupportLibrary = true
        buildConfigField(
            "String",
            "TERMINAL_USER_AGENT",
            "YunQiaoMerchantTerminal/2.0".asBuildConfigString(),
        )
        buildConfigField("String", "BUILD_REVISION", buildRevision.get().asBuildConfigString())
    }

    signingConfigs {
        if (hasCompleteReleaseSigning) {
            create("release") {
                storeFile = file(releaseSigning.getValue("storeFile").get())
                storePassword = releaseSigning.getValue("storePassword").get()
                keyAlias = releaseSigning.getValue("keyAlias").get()
                keyPassword = releaseSigning.getValue("keyPassword").get()
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            buildConfigField("String", "CASHIER_WEB_URL", debugCashierWebUrl.get().asBuildConfigString())
            buildConfigField(
                "String",
                "TRUSTED_PAGE_ORIGIN",
                debugTrustedPageOrigin.get().asBuildConfigString(),
            )
            buildConfigField(
                "String",
                "TRUSTED_RESOURCE_HOSTS",
                debugTrustedResourceHosts.get().asBuildConfigString(),
            )
            buildConfigField(
                "String",
                "CONNECTOR_API_BASE_URL",
                debugConnectorApiBaseUrl.get().asBuildConfigString(),
            )
            buildConfigField("String", "BUILD_CHANNEL", "debug".asBuildConfigString())
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            if (hasCompleteReleaseSigning) {
                signingConfig = signingConfigs.getByName("release")
            }
            buildConfigField(
                "String",
                "CASHIER_WEB_URL",
                "https://cashier.huayueyouxuan.com/".asBuildConfigString(),
            )
            buildConfigField(
                "String",
                "TRUSTED_PAGE_ORIGIN",
                "https://cashier.huayueyouxuan.com".asBuildConfigString(),
            )
            buildConfigField(
                "String",
                "TRUSTED_RESOURCE_HOSTS",
                "api.huayueyouxuan.com".asBuildConfigString(),
            )
            buildConfigField(
                "String",
                "CONNECTOR_API_BASE_URL",
                "https://api.huayueyouxuan.com/api/v1".asBuildConfigString(),
            )
            buildConfigField("String", "BUILD_CHANNEL", "release".asBuildConfigString())
        }
    }

    buildFeatures {
        buildConfig = true
        compose = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }

    lint {
        abortOnError = true
        checkReleaseBuilds = true
    }

    testOptions {
        unitTests.isIncludeAndroidResources = true
    }
}

tasks.configureEach {
    if (
        name == "packageRelease" ||
        name == "assembleRelease" ||
        name == "bundleRelease"
    ) {
        doFirst {
            if (!hasCompleteReleaseSigning) {
                throw GradleException(
                    "Release signing is required. Configure all four YUNQIAO_RELEASE_* values.",
                )
            }
        }
    }
}

base {
    archivesName.set("yunqiao-merchant-terminal-v${terminalVersionName}")
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")

    implementation(composeBom)
    androidTestImplementation(composeBom)
    implementation("androidx.activity:activity-compose:1.10.0")
    implementation("androidx.activity:activity-ktx:1.10.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.runtime:runtime")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.core:core-splashscreen:1.0.1")
    implementation("androidx.datastore:datastore-preferences:1.1.2")
    implementation("androidx.lifecycle:lifecycle-process:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-service:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.room:room-ktx:2.6.1")
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.work:work-runtime-ktx:2.10.0")
    implementation("com.google.zxing:core:3.5.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    kapt("androidx.room:room-compiler:2.6.1")

    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
    testImplementation("androidx.room:room-testing:2.6.1")
    testImplementation("androidx.test:core:1.6.1")
    testImplementation("org.json:json:20240303")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
    testImplementation("org.robolectric:robolectric:4.14.1")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
}
