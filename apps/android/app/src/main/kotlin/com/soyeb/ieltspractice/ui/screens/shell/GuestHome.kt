package com.soyeb.ieltspractice.ui.screens.shell

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.dp
import com.soyeb.ieltspractice.R
import com.soyeb.ieltspractice.core.Band
import com.soyeb.ieltspractice.ui.ScreenScaffold
import com.soyeb.ieltspractice.ui.nav.AppNav
import com.soyeb.ieltspractice.ui.nav.Bank
import com.soyeb.ieltspractice.ui.community.QuotaSummary
import com.soyeb.ieltspractice.ui.theme.AppCard
import com.soyeb.ieltspractice.ui.theme.Chip
import com.soyeb.ieltspractice.ui.theme.PrimaryButton
import com.soyeb.ieltspractice.ui.theme.SecondaryButton
import com.soyeb.ieltspractice.ui.theme.SectionTitle
import com.soyeb.ieltspractice.ui.theme.ext

private class Feature(val icon: Painter, val title: String, val body: String)

private val example = listOf("Fluency and coherence" to 6.5, "Lexical resource" to 7.0, "Grammatical range and accuracy" to 6.0, "Pronunciation" to 6.5)

/** Home for a signed-out visitor (web components/dashboard/GuestHome.tsx): what the product does, a labelled example result, and the way in. */
@Composable
fun GuestHome(nav: AppNav) {
    val e = MaterialTheme.ext
    val features = listOf(
        Feature(painterResource(R.drawable.ic_mic), "Speaking test", "All three parts, recorded. Fluency, vocabulary, grammar and pronunciation are scored, with your pauses timed in the transcript."),
        Feature(painterResource(R.drawable.ic_chat), "Live examiner", "A spoken conversation: an AI examiner asks, listens and follows up on what you say."),
        Feature(painterResource(R.drawable.ic_edit), "Writing Task 1 and 2", "Timed tasks marked against the public band descriptors, with each mistake underlined and corrected."),
        Feature(painterResource(R.drawable.ic_alert), "Mistake log", "The errors you repeat, grouped, so you know what to fix first."),
        Feature(painterResource(R.drawable.ic_review), "Review deck", "Turn corrections into short flashcards that come back just before you forget them."),
    )
    ScreenScaffold("Home", large = true) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Practise IELTS Speaking and Writing", style = MaterialTheme.typography.headlineMedium, color = e.ink)
            Text("Timed practice with a band for every criterion, and each mistake marked exactly where you made it.", style = MaterialTheme.typography.bodyLarge, color = e.muted)
        }
        PrimaryButton("Create account", { nav.openLogin("Create an account to start practising.", signUp = true) }, Modifier.fillMaxWidth())
        SecondaryButton("Sign in", { nav.openLogin("Sign in to continue your practice.") }, Modifier.fillMaxWidth())

        QuotaSummary(nav)

        AppCard {
            SectionTitle("What you get")
            features.forEach { f ->
                Row(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.Top) {
                    Icon(f.icon, null, Modifier.size(24.dp), tint = e.muted)
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(f.title, style = MaterialTheme.typography.titleMedium, color = e.ink)
                        Text(f.body, style = MaterialTheme.typography.bodyMedium, color = e.muted)
                    }
                }
            }
        }

        AppCard {
            SectionTitle("What a result looks like")
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Top) {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Chip("Example, not a real score")
                    Text("Speaking, Part 2", style = MaterialTheme.typography.bodySmall, color = e.muted)
                }
                BigNumber(Band.format(6.5))
            }
            example.forEach { (name, band) ->
                Column(
                    Modifier.padding(top = 8.dp).clearAndSetSemantics { contentDescription = "$name: example band ${Band.format(band)} of 9" },
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(name, style = MaterialTheme.typography.bodyMedium, color = e.ink)
                        Text(Band.format(band), style = MaterialTheme.typography.titleSmall, color = e.ink)
                    }
                    BandBar(band / 9, name, fill = e.muted, height = 6.dp)
                }
            }
        }

        AppCard {
            SectionTitle("Look around first")
            Text(
                "Everything here opens without an account, and you can take a speaking and a writing test as a guest. History, mistakes and review need an account.",
                style = MaterialTheme.typography.bodyMedium, color = e.muted,
            )
            LinkButton("Browse the prompt bank", { nav.go(Bank("")) })
        }
    }
}
