package com.soyeb.ieltspractice.ui.screens.shell

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.soyeb.ieltspractice.LocalApp
import com.soyeb.ieltspractice.R
import com.soyeb.ieltspractice.core.AttemptPage
import com.soyeb.ieltspractice.core.Band
import com.soyeb.ieltspractice.core.LrAttemptItem
import com.soyeb.ieltspractice.ui.nav.AppNav
import com.soyeb.ieltspractice.ui.nav.AttemptResult
import com.soyeb.ieltspractice.ui.nav.LrResult
import com.soyeb.ieltspractice.ui.nav.LrRun
import com.soyeb.ieltspractice.ui.theme.AppCard
import com.soyeb.ieltspractice.ui.theme.AppText
import com.soyeb.ieltspractice.ui.theme.Chip
import com.soyeb.ieltspractice.ui.theme.SecondaryButton
import com.soyeb.ieltspractice.ui.theme.SectionTitle
import com.soyeb.ieltspractice.ui.theme.ext

private class Recent(val id: String, val skill: String, val title: String, val part: String, val mode: String, val at: String, val band: Double?, val state: String)

/**
 * "Your recent tests" for a guest session (web components/dashboard/GuestRecent.tsx, iOS Views/GuestRecentView.swift).
 * Guests have no History screen; the server caps their GET /api/attempts at 10. Up to 5, newest first; nothing for an account or when empty.
 * [skill]: "" for every skill (Home), or speaking | writing | listening | reading for that hub.
 */
@Composable
fun GuestRecentSection(nav: AppNav, skill: String = "") {
    val api = LocalApp.current.api
    val token by api.token.collectAsState()
    val account by api.hasAccount.collectAsState()
    val guest = token != null && !account
    val rows by produceState(emptyList<Recent>(), guest, skill) {
        if (!guest) { value = emptyList(); return@produceState }
        val sp = skill == "speaking" || skill == "writing"
        val out = mutableListOf<Recent>()
        if (skill.isEmpty() || sp) runCatching { api.get<AttemptPage>("/api/attempts", if (sp) mapOf("skill" to skill) else emptyMap()) }.getOrNull()?.items?.forEach {
            out += Recent(it.id, it.skill, it.promptTitle, "${if (it.skill == "speaking") "Part" else "Task"} ${it.part}", it.mode, it.createdAt, it.overall,
                when (it.status) { "done" -> "done"; "recording" -> "open"; "failed" -> "failed"; else -> "scoring" })
        }
        if (skill.isEmpty() || skill == "listening" || skill == "reading") runCatching { api.getList<LrAttemptItem>("/api/lr/attempts") }.getOrNull()
            ?.filter { skill.isEmpty() || it.skill == skill }?.forEach {
                out += Recent(it.id, it.skill, it.title, if (it.skill == "listening") "Listening" else "Reading", it.mode, it.startedAt, it.band, if (it.status == "submitted") "done" else "open")
            }
        value = out.sortedByDescending { it.at }.take(5)
    }
    if (!guest || rows.isEmpty()) return
    val e = MaterialTheme.ext
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SectionTitle("Your recent tests")
        AppCard(padding = 0.dp) {
            rows.forEachIndexed { i, r ->
                if (i > 0) HorizontalDivider(Modifier.padding(start = 16.dp), color = e.line)
                val lr = r.skill == "listening" || r.skill == "reading"
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 56.dp)
                        .clickable(role = Role.Button) { nav.go(if (lr) (if (r.state == "open") LrRun(r.id) else LrResult(r.id)) else AttemptResult.of(r.id)) }
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top,
                ) {
                    Icon(
                        painterResource(when (r.skill) { "speaking" -> R.drawable.ic_mic; "listening" -> R.drawable.ic_sp_headphones; "reading" -> R.drawable.ic_lr_book; else -> R.drawable.ic_edit }),
                        null, Modifier.padding(top = 2.dp).size(20.dp), tint = e.muted,
                    )
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(r.title, style = MaterialTheme.typography.titleSmall, color = e.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                            Chip(if (r.mode == "practice") "Practice" else if (r.mode == "live") "Live" else "Exam", color = if (r.mode == "practice") e.muted else e.brand)
                            Text("${r.part}, ${ShellDate.date(r.at)}", style = MaterialTheme.typography.bodySmall, color = e.muted)
                        }
                    }
                    when (r.state) {
                        "open" -> Chip("In progress, resume", color = e.warnText)
                        "scoring" -> Chip("Scoring", color = e.brand)
                        "failed" -> Chip("Scoring failed", color = e.bad)
                        else -> r.band?.let { b -> Text(Band.format(b), Modifier.clearAndSetSemantics { contentDescription = "Band ${Band.format(b)}" }, style = AppText.band(20), color = e.ink) }
                    }
                }
            }
        }
        Text("These live on this device only. Create an account to keep them and unlock full History.", style = MaterialTheme.typography.bodySmall, color = e.muted)
        SecondaryButton("Create account", { nav.openLogin("Create an account to keep your tests and unlock full History.", signUp = true) })
    }
}
