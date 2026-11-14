package app.mreader.desktop

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.annotation.Keep
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Tokens are encrypted with a non-exportable key held by Android Keystore. */
@Keep
object Secrets {
    private const val ALIAS = "mreader.credentials.v1"
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    @JvmStatic @Keep @Synchronized
    fun get(context: Context, name: String): String? {
        val saved = context.getSharedPreferences(ALIAS, Context.MODE_PRIVATE).getString(name, null) ?: return null
        val parts = saved.split(":", limit = 2)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)))
        return String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), Charsets.UTF_8)
    }
    @JvmStatic @Keep @Synchronized
    fun set(context: Context, name: String, value: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val saved = Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(cipher.doFinal(value.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
        check(context.getSharedPreferences(ALIAS, Context.MODE_PRIVATE).edit().putString(name, saved).commit())
        return "ok"
    }
    @JvmStatic @Keep @Synchronized
    fun remove(context: Context, name: String): String {
        check(context.getSharedPreferences(ALIAS, Context.MODE_PRIVATE).edit().remove(name).commit())
        return "ok"
    }
}
