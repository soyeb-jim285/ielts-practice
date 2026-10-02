package com.soyeb.ieltspractice.core

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.first
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Where the Better Auth bearer token lives between launches. */
interface TokenStore {
    suspend fun load(): String?
    /** [guest]: the token belongs to an anonymous guest session (no account yet). */
    suspend fun save(token: String, guest: Boolean = false)
    suspend fun clear()
    suspend fun loadGuest(): Boolean = false
}

/** Demo mode and tests: nothing touches disk. */
class MemoryTokenStore(private var token: String? = null) : TokenStore {
    private var guest = false
    override suspend fun load() = token
    override suspend fun save(token: String, guest: Boolean) { this.token = token; this.guest = guest }
    override suspend fun clear() { token = null; guest = false }
    override suspend fun loadGuest() = guest
}

private val Context.sessionStore by preferencesDataStore("session")

/** DataStore holds `base64(iv + AES-GCM ciphertext)`; the AES key never leaves the Android Keystore. */
class KeystoreTokenStore(context: Context) : TokenStore {
    private val store = context.applicationContext.sessionStore
    private val key = stringPreferencesKey("token")
    private val guestKey = booleanPreferencesKey("guest")

    private fun secret(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val spec = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build()
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply { init(spec) }.generateKey()
    }

    override suspend fun load(): String? = runCatching {
        val raw = Base64.decode(store.data.first()[key] ?: return null, Base64.NO_WRAP)
        val cipher = Cipher.getInstance(TRANSFORM).apply { init(Cipher.DECRYPT_MODE, secret(), GCMParameterSpec(128, raw, 0, IV_BYTES)) }
        String(cipher.doFinal(raw, IV_BYTES, raw.size - IV_BYTES), Charsets.UTF_8)
    }.getOrNull() // a lost key (restore, reinstall) reads as signed out

    override suspend fun save(token: String, guest: Boolean) {
        val cipher = Cipher.getInstance(TRANSFORM).apply { init(Cipher.ENCRYPT_MODE, secret()) }
        val sealed = cipher.iv + cipher.doFinal(token.toByteArray(Charsets.UTF_8))
        store.edit { it[key] = Base64.encodeToString(sealed, Base64.NO_WRAP); it[guestKey] = guest }
    }

    override suspend fun loadGuest(): Boolean = runCatching { store.data.first()[guestKey] == true }.getOrDefault(false)

    override suspend fun clear() { store.edit { it.remove(key); it.remove(guestKey) } }

    private companion object {
        const val ALIAS = "ielts-session-token"
        const val TRANSFORM = "AES/GCM/NoPadding"
        const val IV_BYTES = 12
    }
}
