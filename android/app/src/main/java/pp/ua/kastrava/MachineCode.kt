package pp.ua.kastrava

import android.os.Build
import android.provider.Settings
import java.security.MessageDigest

/**
 * One-device machine identity, interoperable with the desktop licensing flow
 * (src/license.js) and the api.kastrava.in license server, which treats
 * machine_id as an opaque uppercase string.
 *
 * Desktop:  sha256("linux|x64|<os-anchor>")  -> KAS2-XXXX-…
 * Android:  sha256("android|<abi>|<android-id>") -> KAS2-XXXX-…
 * ANDROID_ID is stable per device per signing key — same semantics as the
 * desktop OS-install anchor (reinstalls keep working, new device = new code).
 */
object MachineCode {
    fun current(androidId: String): String {
        val abi = Build.SUPPORTED_ABIS.firstOrNull() ?: Build.CPU_ABI ?: "unknown"
        val digest = MessageDigest.getInstance("SHA-256")
            .digest("android|$abi|$androidId".toByteArray(Charsets.UTF_8))
        val hex = digest.joinToString("") { "%02X".format(it) }
        return "KAS2-" + hex.chunked(4).joinToString("-")
    }
}
