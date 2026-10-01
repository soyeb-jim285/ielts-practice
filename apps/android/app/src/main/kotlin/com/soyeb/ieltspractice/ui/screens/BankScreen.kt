package com.soyeb.ieltspractice.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.soyeb.ieltspractice.LocalApp
import com.soyeb.ieltspractice.ui.ScreenScaffold
import com.soyeb.ieltspractice.ui.nav.AppNav
import com.soyeb.ieltspractice.ui.nav.Bank
import com.soyeb.ieltspractice.ui.nav.SpeakingSession
import com.soyeb.ieltspractice.ui.nav.WritingEditor
import com.soyeb.ieltspractice.ui.screens.shell.AppField
import com.soyeb.ieltspractice.ui.screens.shell.BankGroup
import com.soyeb.ieltspractice.ui.screens.shell.BankMeta
import com.soyeb.ieltspractice.ui.screens.shell.BankPage
import com.soyeb.ieltspractice.ui.screens.shell.BankPrompt
import com.soyeb.ieltspractice.ui.screens.shell.EmptyState
import com.soyeb.ieltspractice.ui.screens.shell.FilterMenu
import com.soyeb.ieltspractice.ui.screens.shell.GroupHeader
import com.soyeb.ieltspractice.ui.screens.shell.LinkButton
import com.soyeb.ieltspractice.ui.screens.shell.PageResult
import com.soyeb.ieltspractice.ui.screens.shell.Paged
import com.soyeb.ieltspractice.ui.screens.shell.RowDivider
import com.soyeb.ieltspractice.ui.screens.shell.Segmented
import com.soyeb.ieltspractice.ui.screens.shell.bankGroupLabel
import com.soyeb.ieltspractice.ui.screens.shell.bankQuestion
import com.soyeb.ieltspractice.ui.screens.shell.bankTopics
import com.soyeb.ieltspractice.ui.screens.shell.bankTypeLabel
import com.soyeb.ieltspractice.ui.screens.shell.bankTypes
import com.soyeb.ieltspractice.ui.screens.shell.partNum
import com.soyeb.ieltspractice.ui.screens.shell.partOptions
import com.soyeb.ieltspractice.ui.screens.shell.partVariant
import com.soyeb.ieltspractice.ui.screens.shell.pretty
import com.soyeb.ieltspractice.ui.screens.shell.runsBy
import com.soyeb.ieltspractice.ui.theme.AppCard
import com.soyeb.ieltspractice.ui.theme.Chip
import com.soyeb.ieltspractice.ui.theme.ErrorLine
import com.soyeb.ieltspractice.ui.theme.SecondaryButton
import com.soyeb.ieltspractice.ui.theme.ext
import kotlinx.coroutines.delay
import java.util.Locale

// Mirrors: iOS Views/BankView.swift, web routes/_app/bank.tsx. Public: guests browse it, starting a prompt asks them to sign in.

/** Every question and task you can practise, with the web's filters (skill, part or task, type, topic, source) and search. */
@Composable
fun BankScreen(route: Bank, nav: AppNav) {
    val api = LocalApp.current.api
    val scope = rememberCoroutineScope()
    val me by api.me.collectAsState()
    var skill by remember { mutableStateOf(route.skill) } // "" = all skills
    var partKey by remember { mutableStateOf("all") }
    var type by remember { mutableStateOf("") }
    var topic by remember { mutableStateOf("") }
    var source by remember { mutableStateOf("") }
    var query by remember { mutableStateOf("") }
    var searched by remember { mutableStateOf("") } // `query` once typing pauses
    var meta by remember { mutableStateOf(emptyList<BankGroup>()) }

    val q = searched.trim()
    val filtered = skill.isNotEmpty() || type.isNotEmpty() || topic.isNotEmpty() || source.isNotEmpty() || q.isNotEmpty()
    val paged = remember {
        Paged(scope) { page ->
            val r = api.get<BankPage>(
                "/api/prompts",
                mapOf(
                    "skill" to skill.ifEmpty { null }, "part" to partNum(partKey)?.toString(), "variant" to partVariant(partKey),
                    "type" to type.ifEmpty { null }, "topic" to topic.ifEmpty { null }, "source" to source.ifEmpty { null },
                    "q" to searched.trim().ifEmpty { null }, "page" to page.toString(),
                ),
            )
            PageResult(r.items, r.total)
        }
    }
    LaunchedEffect(Unit) { runCatching { meta = api.get<BankMeta>("/api/prompts/meta").groups } }
    LaunchedEffect(query) { if (query != searched) { delay(300); searched = query } } // debounce typing
    LaunchedEffect(skill, partKey, type, topic, source, searched) { paged.reset() }

    fun clear() { query = ""; searched = ""; skill = ""; partKey = "all"; type = ""; topic = ""; source = "" }
    fun open(p: BankPrompt) = nav.requireSignIn("Sign in to practise this prompt.") {
        nav.go(if (p.skill == "speaking") SpeakingSession("prompt", promptId = p.id) else WritingEditor("prompt", promptId = p.id))
    }

    val types = bankTypes(meta, skill, partKey)
    val topics = bankTopics(meta, skill, partKey)
    val groups = runsBy(paged.items) { "${it.skill}${it.part}" }

    ScreenScaffold("Prompt bank", onBack = nav::back, scroll = false) {
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                AppCard {
                    AppField(query, { query = it }, "Search titles and questions")
                    Segmented(listOf("" to "All", "speaking" to "Speaking", "writing" to "Writing"), skill, { skill = it; partKey = "all"; type = ""; topic = "" })
                    if (skill.isNotEmpty()) {
                        FilterMenu(if (skill == "speaking") "Part" else "Task", partOptions(skill).map { it.id to it.label }, partKey, { partKey = it; type = ""; topic = "" })
                    }
                    if (types.size > 1) FilterMenu("Type", listOf("" to "Any type") + types.map { it to bankTypeLabel(it) }, type, { type = it })
                    FilterMenu("Topic", listOf("" to "All topics") + topics.map { it to pretty(it) }, topic, { topic = it })
                    // Without Cambridge access everything is generated, so a source filter means nothing.
                    if (me?.cambridgeAccess == true) {
                        FilterMenu("Source", listOf("" to "All sources", "generated" to "Generated", "cambridge" to "Cambridge"), source, { source = it })
                    }
                    if (filtered) LinkButton("Clear filters", ::clear)
                    Text(
                        paged.total?.let { "${String.format(Locale.US, "%,d", it)} ${if (it == 1) "prompt" else "prompts"}${if (filtered) " match" else ""}" }
                            ?: "Every question and task you can practise.",
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.ext.muted,
                    )
                }
            }
            paged.error?.let { msg ->
                item {
                    AppCard {
                        ErrorLine(msg)
                        SecondaryButton("Try again", { paged.reset() })
                    }
                }
            }
            if (paged.items.isEmpty() && paged.error == null) {
                item {
                    if (paged.loading) Box(Modifier.fillMaxWidth().padding(24.dp), Alignment.Center) { CircularProgressIndicator() }
                    else EmptyState(
                        if (filtered) "No prompts match" else "The bank is empty",
                        if (filtered) "Try a broader search or fewer filters." else "Seed the prompt bank on the server to start practising.",
                        action = if (filtered) "Clear filters" else null, onAction = ::clear, secondary = true,
                    )
                }
            }
            groups.forEach { (_, list) ->
                item(key = list.first().id) {
                    Column {
                        GroupHeader(bankGroupLabel(list.first(), partKey))
                        AppCard(padding = 0.dp) {
                            list.forEachIndexed { i, p ->
                                if (i > 0) RowDivider()
                                BankRow(p) { open(p) }
                            }
                        }
                    }
                }
            }
            item {
                if (paged.items.isNotEmpty() && paged.loading) Box(Modifier.fillMaxWidth().padding(16.dp), Alignment.Center) { CircularProgressIndicator() }
                LaunchedEffect(paged.items.size, paged.hasMore) { paged.more() } // the end of the list came into view
            }
        }
    }
}

@Composable
private fun BankRow(p: BankPrompt, onClick: () -> Unit) {
    val e = MaterialTheme.ext
    val question = bankQuestion(p)?.takeIf { it != p.title }
    Column(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).clickable(role = Role.Button, onClick = onClick).padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(p.title, style = MaterialTheme.typography.bodyLarge, color = e.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            if (question != null) Text(question, Modifier.weight(1f, fill = false), style = MaterialTheme.typography.bodySmall, color = e.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (p.source == "cambridge") Chip(p.sourceRef ?: "Cambridge", color = e.brand)
            if (p.done == true) Chip("Done", color = e.goodText)
        }
    }
}
