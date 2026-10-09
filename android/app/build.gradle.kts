plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "pp.ua.kastrava"
    compileSdk = 34

    defaultConfig {
        applicationId = "pp.ua.kastrava"
        minSdk = 26
        targetSdk = 34
        // Mirrors the desktop release: 101.4.6.
        versionCode = 1014006
        versionName = "101.4.6"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Release signing comes from env (CI secrets). Without it the
            // build falls back to debug signing so dispatch builds still
            // compile — but only the secret-signed APK ships to users.
            //   KASTRAVA_KS_FILE, KASTRAVA_KS_PASS, KASTRAVA_KEY_ALIAS
            val ksFile = System.getenv("KASTRAVA_KS_FILE")
            val ksPass = System.getenv("KASTRAVA_KS_PASS")
            if (!ksFile.isNullOrBlank() && !ksPass.isNullOrBlank() && file(ksFile).exists()) {
                signingConfig = signingConfigs.create("kastravaRelease") {
                    storeFile = file(ksFile)
                    storePassword = ksPass
                    keyAlias = System.getenv("KASTRAVA_KEY_ALIAS") ?: "kastrava"
                    keyPassword = ksPass
                }
            } else {
                signingConfig = signingConfigs.getByName("debug")
                println("WARNING: no release keystore in env — signing release with debug key (do not ship)")
            }
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        viewBinding = true
        buildConfig = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.preference:preference-ktx:1.2.1")
    implementation("com.google.android.material:material:1.12.0")
    // EncryptedSharedPreferences (AndroidKeyStore) holds the sync encryption
    // key after first login — the password itself is never stored.
    implementation("androidx.security:security-crypto:1.0.0")
    // Ed25519 license-signature verification on every API level
    // (java.security Ed25519 needs API 33+; BouncyCastle covers 26+).
    implementation("org.bouncycastle:bcprov-jdk18on:1.78.1")
}
