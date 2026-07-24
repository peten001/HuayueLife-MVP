import org.gradle.api.provider.Provider

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.kapt")
}

fun configValue(
    propertyName: String,
    environmentName: String,
    fallback: String,
): Provider<String> = providers.gradleProperty(propertyName)
    .orElse(providers.environmentVariable(environmentName))
    .orElse(fallback)

val terminalVersionCode = providers.provider { 7 }
val terminalVersionName = providers.provider { "1.0.0-rc3" }

fun String.asBuildConfigString(): String =
    "\"${replace("\\", "\\\\").replace("\"", "\\\"")}\""

val debugCashierWebUrl = configValue(
    propertyName = "cashierWebUrlDebug",
    environmentName = "CASHIER_WEB_URL_DEBUG",
    fallback = "",
)
val releaseCashierWebUrl = providers.provider { "https://cashier.huayueyouxuan.com/" }
val debugTrustedPageOrigin = configValue(
    propertyName = "trustedPageOriginDebug",
    environmentName = "TRUSTED_PAGE_ORIGIN_DEBUG",
    fallback = "",
)
val releaseTrustedPageOrigin = providers.provider { "https://cashier.huayueyouxuan.com" }
val debugTrustedResourceHosts = configValue(
    propertyName = "trustedResourceHostsDebug",
    environmentName = "TRUSTED_RESOURCE_HOSTS_DEBUG",
    fallback = "",
)
val releaseTrustedResourceHosts = providers.provider { "api.huayueyouxuan.com" }
val debugConnectorApiBaseUrl = configValue(
    propertyName = "connectorApiBaseUrlDebug",
    environmentName = "CONNECTOR_API_BASE_URL_DEBUG",
    fallback = "",
)
val releaseConnectorApiBaseUrl = providers.provider {
    "https://api.huayueyouxuan.com/api/v1"
}
val buildRevision = configValue(
    propertyName = "buildRevision",
    environmentName = "BUILD_REVISION",
    fallback = "local-build",
)

val releaseStoreFile = configValue(
    propertyName = "yunqiaoReleaseStoreFile",
    environmentName = "YUNQIAO_RELEASE_STORE_FILE",
    fallback = "",
)
val releaseStorePassword = configValue(
    propertyName = "yunqiaoReleaseStorePassword",
    environmentName = "YUNQIAO_RELEASE_STORE_PASSWORD",
    fallback = "",
)
val releaseKeyAlias = configValue(
    propertyName = "yunqiaoReleaseKeyAlias",
    environmentName = "YUNQIAO_RELEASE_KEY_ALIAS",
    fallback = "",
)
val releaseKeyPassword = configValue(
    propertyName = "yunqiaoReleaseKeyPassword",
    environmentName = "YUNQIAO_RELEASE_KEY_PASSWORD",
    fallback = "",
)
val releaseSigningValues = listOf(
    releaseStoreFile,
    releaseStorePassword,
    releaseKeyAlias,
    releaseKeyPassword,
)
val hasAnyReleaseSigningValue = releaseSigningValues.any { !it.orNull.isNullOrBlank() }
val hasReleaseSigning = releaseSigningValues.all { !it.orNull.isNullOrBlank() }

check(!hasAnyReleaseSigningValue || hasReleaseSigning) {
    "Release signing is only partially configured; provide all four signing properties or YUNQIAO_RELEASE_* values."
}

android {
    namespace = "com.yunqiao.life.merchantterminal"
    compileSdk = 35
    buildToolsVersion = "35.0.0"

    defaultConfig {
        applicationId = "com.yunqiao.life.merchantterminal"
        minSdk = 26
        targetSdk = 35
        versionCode = terminalVersionCode.get()
        versionName = terminalVersionName.get()

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables.useSupportLibrary = true
        buildConfigField("String", "TERMINAL_USER_AGENT", "YunQiaoMerchantTerminal/1.0".asBuildConfigString())
        buildConfigField("String", "BUILD_REVISION", buildRevision.get().asBuildConfigString())
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = rootProject.file(releaseStoreFile.get())
                storePassword = releaseStorePassword.get()
                keyAlias = releaseKeyAlias.get()
                keyPassword = releaseKeyPassword.get()
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
            buildConfigField("String", "BUILD_CHANNEL", "debug".asBuildConfigString())
            buildConfigField(
                "String",
                "CONNECTOR_API_BASE_URL",
                debugConnectorApiBaseUrl.get().asBuildConfigString(),
            )
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            if (hasReleaseSigning) {
                signingConfig = signingConfigs.getByName("release")
            }
            buildConfigField("String", "CASHIER_WEB_URL", releaseCashierWebUrl.get().asBuildConfigString())
            buildConfigField(
                "String",
                "TRUSTED_PAGE_ORIGIN",
                releaseTrustedPageOrigin.get().asBuildConfigString(),
            )
            buildConfigField(
                "String",
                "TRUSTED_RESOURCE_HOSTS",
                releaseTrustedResourceHosts.get().asBuildConfigString(),
            )
            buildConfigField("String", "BUILD_CHANNEL", "release".asBuildConfigString())
            buildConfigField(
                "String",
                "CONNECTOR_API_BASE_URL",
                releaseConnectorApiBaseUrl.get().asBuildConfigString(),
            )
        }
        create("printClosureTest") {
            initWith(getByName("release"))
            applicationIdSuffix = ".printclosuretest1"
            signingConfig = signingConfigs.getByName("debug")
            matchingFallbacks += listOf("release")
            proguardFile("proguard-print-closure-test.pro")
            resValue("string", "app_name", "YunQiao Terminal Print Closure Test")
        }
    }

    buildFeatures {
        buildConfig = true
        viewBinding = true
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
        warningsAsErrors = false
    }

    testOptions {
        unitTests.isIncludeAndroidResources = true
    }
}

androidComponents {
    onVariants(selector().withBuildType("printClosureTest")) { variant ->
        variant.outputs.forEach { output ->
            output.versionName.set("1.0.0-print-closure-test1")
        }
    }
}

base {
    archivesName.set("yunqiao-merchant-terminal-v${terminalVersionName.get()}")
}

dependencies {
    implementation("androidx.activity:activity-ktx:1.10.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.core:core-splashscreen:1.0.1")
    implementation("androidx.datastore:datastore-preferences:1.1.2")
    implementation("androidx.lifecycle:lifecycle-service:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.room:room-ktx:2.6.1")
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.work:work-runtime-ktx:2.10.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("com.google.zxing:core:3.5.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    kapt("androidx.room:room-compiler:2.6.1")

    testImplementation("junit:junit:4.13.2")
    testImplementation("androidx.test:core:1.6.1")
    testImplementation("org.robolectric:robolectric:4.14.1")
    testImplementation("androidx.room:room-testing:2.6.1")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1")
}
