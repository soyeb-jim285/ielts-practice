package com.soyeb.ieltspractice.ui.community

import android.os.Build
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.soyeb.ieltspractice.LocalApp
import com.soyeb.ieltspractice.LocalDemo
import com.soyeb.ieltspractice.core.Balance
import com.soyeb.ieltspractice.core.BalanceCopy
import com.soyeb.ieltspractice.core.Codes
import com.soyeb.ieltspractice.core.DemoCommunity
import com.soyeb.ieltspractice.core.FairUse
import com.soyeb.ieltspractice.core.Gate
import com.soyeb.ieltspractice.core.GateAction
import com.soyeb.ieltspractice.core.GateText
import com.soyeb.ieltspractice.core.Quota
import com.soyeb.ieltspractice.core.QuotaCopy
import com.soyeb.ieltspractice.ui.nav.AppNav
import com.soyeb.ieltspractice.ui.nav.Tab
import com.soyeb.ieltspractice.ui.screens.shell.LinkButton
import com.soyeb.ieltspractice.ui.screens.shell.RowDivider
import com.soyeb.ieltspractice.ui.theme.AppCard
import com.soyeb.ieltspractice.ui.theme.AppText
import com.soyeb.ieltspractice.ui.theme.CardShape
import com.soyeb.ieltspractice.ui.theme.PrimaryButton
import com.soyeb.ieltspractice.ui.theme.SecondaryButton
import com.soyeb.ieltspractice.ui.theme.SectionTitle
import com.soyeb.ieltspractice.ui.theme.ext
import kotlinx.coroutines.delay

// Community mode UI (docs/community.md, Client UX). Mirrors web components/community/* and iOS Views/Community*.swift.
// Teal means "act here": the balance meter is neutral (amber under 10 %), and the one teal button in a panel is the way forward.

/** The latest quota, refreshed when the screen opens (at most once a minute). Null until the first answer. */
@Composable
fun rememberQuota(): Quota? {
    val api = LocalApp.current.api
    val quota by api.quota.collectAsState()
    LaunchedEffect(Unit) { api.refreshQuotaIfStale() }
    return quota
}

// MARK: Balance meter

/** "Community balance $12.40 of $20" with a thin bar. Draws nothing when the balance is unknown or the key has no limit. */
@Composable
fun BalanceMeter(balance: Balance?, modifier: Modifier = Modifier) {
    val line = BalanceCopy.line(balance) ?: return
    val fraction = BalanceCopy.fraction(balance) ?: return
    val low = BalanceCopy.low(balance)
    val e = MaterialTheme.ext
    val fill = if (low) e.warn else e.muted
    val spoken = line + if (low) ", running low" else ""
    Column(modifier.fillMaxWidth().semantics(mergeDescendants = true) { contentDescription = spoken }, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text("Community balance", style = MaterialTheme.typography.bodySmall, color = e.muted)
            Text(
                line.removePrefix("Community balance "),
                style = MaterialTheme.typography.labelMedium.merge(AppText.num), color = if (low) e.warnText else e.ink,
            )
        }
        Canvas(Modifier.fillMaxWidth().height(6.dp)) {
            val r = CornerRadius(size.height / 2)
            drawRoundRect(e.surface2, Offset.Zero, size, r)
            val w = size.width * fraction
            if (w > 0f) drawRoundRect(fill, Offset.Zero, Size(maxOf(w, size.height), size.height), r)
        }
    }
}

// MARK: Inline quota lines

/** The line under a Start button: "1 test left today", "No tests left. Resets Monday 6:00", "Unlimited with your key". Nothing until known. */
@Composable
fun QuotaCaption(skill: String, modifier: Modifier = Modifier) {
    val q = rememberQuota() ?: return
    val e = MaterialTheme.ext
    val s = q.of(skill)
    Text(
        QuotaCopy.left(q, skill), modifier, style = MaterialTheme.typography.bodySmall,
        color = if (s.blocked != null) e.warnText else e.muted,
    )
}

/** The line under the live examiner's Start button. */
@Composable
fun LiveCaption(modifier: Modifier = Modifier) {
    val q = rememberQuota() ?: return
    val text = when {
        q.liveProviders.isNotEmpty() -> "Runs on your own key"
        q.tier == "guest" -> "Needs your own API key. Create an account first."
        else -> "Needs your own API key. Add one in Settings."
    }
    Text(text, modifier, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.ext.muted)
}

/**
 * "Your tests": what is left for speaking and writing, the community balance, and the way to more (Home and Settings).
 * [action] is the link under the card ("Add your own key"); Settings passes false because the keys are right below.
 */
@Composable
fun QuotaSummary(nav: AppNav, action: Boolean = true) {
    val q = rememberQuota()
    val e = MaterialTheme.ext
    AppCard {
        SectionTitle(if (q?.tier == "guest" || q == null) "Free practice" else "Your tests")
        if (q != null) {
            listOf("speaking" to "Speaking", "writing" to "Writing").forEachIndexed { i, (skill, label) ->
                if (i > 0) RowDivider()
                val s = q.of(skill)
                Column(Modifier.padding(vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                        Text(label, style = MaterialTheme.typography.bodyLarge, color = e.ink)
                        Text(
                            QuotaCopy.leftShort(q, skill), style = MaterialTheme.typography.titleSmall.merge(AppText.num),
                            color = if (s.blocked != null) e.warnText else e.ink,
                        )
                    }
                    if (s.limit != null) {
                        val reset = QuotaCopy.resets(s.resetAt)
                        if (reset != null) Text(reset, style = MaterialTheme.typography.bodySmall, color = e.muted)
                    }
                }
            }
            BalanceMeter(q.communityBalance, Modifier.padding(top = 8.dp))
            if (action) {
                when (q.tier) {
                    "guest" -> LinkButton("Create an account for 1 test a day", { nav.openLogin("Create an account for 1 test a day.", signUp = true) }, Modifier.offset(x = (-12).dp))
                    "community" -> LinkButton("Add your own key for unlimited tests", { nav.openTab(Tab.Settings) }, Modifier.offset(x = (-12).dp))
                }
            }
        } else {
            Text("Checking your tests...", style = MaterialTheme.typography.bodyMedium, color = e.muted)
        }
    }
}

// MARK: The panels

/** Draws the limit panel or the fair-use dialog, and a short "Checking" cover while the quota is fetched. Add once, over the NavHost. */
@Composable
fun GateHost(nav: AppNav) {
    val demo = LocalDemo.current
    LaunchedEffect(demo?.screen) { if (demo != null) DemoCommunity.gate(demo.screen)?.let { nav.gate = it } }
    when (val g = nav.gate) {
        null -> {}
        is Gate.Blocked -> GateSheet(nav, label = GateText.copy(g.code, g.skill, g.tier, g.resetAt, g.needs, g.keep).title) { BlockedContent(nav, g) }
        is Gate.FairUse -> GateSheet(nav, label = FairUse.TITLE) { FairUseContent(nav, g) }
        is Gate.Message -> GateSheet(nav, label = g.title) { MessageContent(nav, g) }
    }
    var showCover by remember { mutableStateOf(false) }
    LaunchedEffect(nav.checking) { if (nav.checking) { delay(350); showCover = true } else showCover = false }
    if (nav.checking && showCover) {
        Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.2f)), contentAlignment = Alignment.Center) {
            Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.ext.surface) {
                Row(Modifier.padding(horizontal = 20.dp, vertical = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(20.dp), color = MaterialTheme.ext.brand, strokeWidth = 2.dp)
                    Text("Checking your tests...", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.ext.ink)
                }
            }
        }
    }
}

/** A bottom sheet. Screenshot tests (Robolectric) can't capture a second window, so there it is drawn inline over the screen. */
@Composable
private fun GateSheet(nav: AppNav, label: String, content: @Composable ColumnScope.() -> Unit) {
    val e = MaterialTheme.ext
    val inline = LocalDemo.current != null && Build.FINGERPRINT.contains("robolectric", ignoreCase = true)
    if (inline) {
        Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.32f)), contentAlignment = Alignment.BottomCenter) {
            Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp), color = e.surface) {
                Column(Modifier.navigationBarsPadding().padding(horizontal = 20.dp).padding(top = 12.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Box(Modifier.align(Alignment.CenterHorizontally).size(width = 32.dp, height = 4.dp).background(e.muted.copy(alpha = 0.5f), CircleShape))
                    content()
                }
            }
        }
    } else {
        ModalBottomSheet(
            onDismissRequest = nav::dismissGate, containerColor = e.surface, contentColor = e.ink,
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        ) {
            Column(
                Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 24.dp).semantics { contentDescription = label },
                verticalArrangement = Arrangement.spacedBy(12.dp), content = content,
            )
        }
    }
}

@Composable
private fun SheetTitle(text: String) =
    Text(text, Modifier.fillMaxWidth().semantics { heading() }, style = MaterialTheme.typography.headlineSmall, color = MaterialTheme.ext.ink)

@Composable
private fun SheetBody(text: String) = Text(text, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.ext.ink)

@Composable
private fun BlockedContent(nav: AppNav, g: Gate.Blocked) {
    val copy = GateText.copy(g.code, g.skill, g.tier, g.resetAt, g.needs, g.keep)
    SheetTitle(copy.title)
    SheetBody(copy.body)
    if (g.code == Codes.BALANCE) BalanceMeter(g.balance, Modifier.padding(vertical = 4.dp))
    Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        copy.primary?.let { (label, action) -> PrimaryButton(label, { act(nav, action, g.tier == "guest") }, Modifier.fillMaxWidth()) }
        val (label, action) = copy.secondary
        // With no primary action the one button there is stays quiet (grey), never teal.
        SecondaryButton(label, { act(nav, action, g.tier == "guest") }, Modifier.fillMaxWidth())
    }
}

@Composable
private fun FairUseContent(nav: AppNav, g: Gate.FairUse) {
    SheetTitle(FairUse.TITLE)
    FairUse.paragraphs(g.quota, g.skill, g.guest).forEach { SheetBody(it) }
    BalanceMeter(g.quota.communityBalance, Modifier.padding(vertical = 4.dp))
    Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        PrimaryButton("Start test", { g.onStart() }, Modifier.fillMaxWidth())
        SecondaryButton(if (g.guest) "Create an account" else "Use my own key", { act(nav, if (g.guest) GateAction.Account else GateAction.Keys, g.guest) }, Modifier.fillMaxWidth())
    }
}

@Composable
private fun MessageContent(nav: AppNav, g: Gate.Message) {
    SheetTitle(g.title)
    SheetBody(g.body)
    SecondaryButton("Close", nav::dismissGate, Modifier.fillMaxWidth().padding(top = 8.dp))
}

private fun act(nav: AppNav, action: GateAction, guest: Boolean) {
    nav.dismissGate()
    when (action) {
        GateAction.Close -> {}
        GateAction.Account -> nav.openLogin(if (guest) "Create an account for 1 test a day." else "Create an account to keep your practice.", signUp = true)
        GateAction.Keys -> nav.openTab(Tab.Settings)
    }
}

// MARK: A guest's result page

/** "This one didn't count against your tests." for a failed analysis or no speech: those are refunded. Nothing for unlimited (own key) users. */
@Composable
fun RefundNote(modifier: Modifier = Modifier) {
    val quota by LocalApp.current.api.quota.collectAsState()
    val q = quota ?: return
    if (q.unlimited) return
    Text("This one didn't count against your tests.", modifier, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.ext.muted)
}

/** Under a guest's own result: they can read it now, but it is only kept for 30 days unless they make an account. */
@Composable
fun GuestResultBar(nav: AppNav) {
    val e = MaterialTheme.ext
    Surface(Modifier.fillMaxWidth(), shape = CardShape, color = e.surface, border = androidx.compose.foundation.BorderStroke(1.dp, e.line)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Create an account to keep this result", style = MaterialTheme.typography.titleSmall, color = e.ink)
            Text("Guest results are kept for 30 days.", style = MaterialTheme.typography.bodySmall, color = e.muted)
            PrimaryButton("Create account", { nav.openLogin("Create an account to keep this result.", signUp = true) }, Modifier.fillMaxWidth())
        }
    }
}
