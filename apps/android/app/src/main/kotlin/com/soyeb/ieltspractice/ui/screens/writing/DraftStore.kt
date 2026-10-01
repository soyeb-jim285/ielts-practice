package com.soyeb.ieltspractice.ui.screens.writing

import android.content.Context
import android.content.SharedPreferences
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext

/** Essay + plan per prompt on this device (`draft:{promptId}`), so leaving or being killed mid-test loses nothing. */
class DraftStore(private val prefs: SharedPreferences) {
    fun load(promptId: String): Draft = decodeDraft(prefs.getString("draft:$promptId", null))

    /** An empty draft is removed rather than stored (a test that was opened and never written in leaves nothing behind). */
    fun save(promptId: String, draft: Draft) {
        prefs.edit().apply { if (draft == Draft()) remove("draft:$promptId") else putString("draft:$promptId", encodeDraft(draft)) }.apply()
    }

    fun clear(promptIds: List<String>) { prefs.edit().apply { promptIds.forEach { remove("draft:$it") } }.apply() }
}

@Composable
fun rememberDraftStore(): DraftStore {
    val context = LocalContext.current.applicationContext
    return remember { DraftStore(context.getSharedPreferences("writing-drafts", Context.MODE_PRIVATE)) }
}
