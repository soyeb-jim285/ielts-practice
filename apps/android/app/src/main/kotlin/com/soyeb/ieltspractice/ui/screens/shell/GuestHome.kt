package com.soyeb.ieltspractice.ui.screens.shell

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.dp
import com.soyeb.ieltspractice.R
import com.soyeb.ieltspractice.core.Band
import com.soyeb.ieltspractice.ui.ScreenScaffold
import com.soyeb.ieltspractice.ui.community.QuotaSummary
import com.soyeb.ieltspractice.ui.nav.AppNav
import com.soyeb.ieltspractice.ui.nav.Bank
import com.soyeb.ieltspractice.ui.nav.LrHub
import com.soyeb.ieltspractice.ui.nav.MockStart
import com.soyeb.ieltspractice.ui.nav.SpeakingSession
import com.soyeb.ieltspractice.ui.nav.Tab
import com.soyeb.ieltspractice.ui.nav.WritingEditor
import com.soyeb.ieltspractice.ui.theme.AppCard
import com.soyeb.ieltspractice.ui.theme.Chip
import com.soyeb.ieltspractice.ui.theme.PrimaryButton
import com.soyeb.ieltspractice.ui.theme.SecondaryButton
import com.soyeb.ieltspractice.ui.theme.SectionTitle
import com.soyeb.ieltspractice.ui.theme.ext

private class Feature(val icon: Int, val title: String, val body: String)

// Same copy as web components/dashboard/GuestHome.tsx.
private val features = listOf(
    Feature(R.drawable.ic_mic, "Speaking test", "All three parts, recorded. Four criteria scored, with your pauses timed in the transcript."),
    Feature(R.drawable.ic_chat, "Live examiner", "A spoken conversation: an AI examiner asks, listens and follows up."),
    Feature(R.drawable.ic_edit, "Writing marked by criterion", "Timed tasks marked against the public band descriptors, each mistake underlined and corrected."),
    Feature(R.drawable.ic_review, "Fix what you repeat", "The mistake log groups the errors you repeat. The review deck turns corrections into flashcards that return just before you forget."),
)

// Illustration only: fixed numbers that show the layout of a result, never a real score.
private val mockExample = listOf("Listening" to 7.5, "Reading" to 6.5, "Writing" to 7.0, "Speaking" to 7.0)
private val speakingExample = listOf("Fluency and coherence" to 6.5, "Lexical resource" to 7.0, "Grammatical range and accuracy" to 6.0, "Pronunciation" to 6.5)

/** Home for a signed-out visitor (web components/dashboard/GuestHome.tsx): the four skills and the mock, a labelled example result, and the way in. */
@Composable
fun GuestHome(nav: AppNav) {
    val e = MaterialTheme.ext
    ScreenScaffold("Home", large = true) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Practise all four IELTS skills", style = MaterialTheme.typography.headlineMedium, color = e.ink)
            Text(
                "Listening, Reading, Writing and Speaking, plus a full mock test. Free to try, no account. Timed practice with a band for every criterion, and each mistake marked exactly where you made it.",
                style = MaterialTheme.typography.bodyLarge, color = e.muted,
            )
        }
        PrimaryButton("Try a speaking test", { nav.startTest("speaking") { nav.go(SpeakingSession("part", 1)) } }, Modifier.fillMaxWidth())
        SecondaryButton("Try a writing test", { nav.startTest("writing") { nav.go(WritingEditor("task2")) } }, Modifier.fillMaxWidth())
        LinkButton("Take a free Listening or Reading test", { nav.go(LrHub("listening")) }, Modifier.offset(x = (-12).dp))

        GuestRecentSection(nav)

        AppCard {
            SectionTitle("Four skills, one mock test")
            Column {
                NavRow("Listening", "Unlimited free practice tests, 40 questions or one part, marked at once with a band", { nav.go(LrHub("listening")) }, icon = R.drawable.ic_sp_headphones)
                RowDivider()
                NavRow("Reading", "Unlimited free practice tests, 40 questions or one passage, marked at once with a band", { nav.go(LrHub("reading")) }, icon = R.drawable.ic_lr_book)
                RowDivider()
                NavRow("Writing", "Task 1 and Task 2, feedback by criterion", { nav.openTab(Tab.Writing) }, icon = R.drawable.ic_edit)
                RowDivider()
                NavRow("Speaking", "Live examiner 11-14 min, or practise one part", { nav.openTab(Tab.Speaking) }, icon = R.drawable.ic_mic)
                RowDivider()
                NavRow("Full mock test", "All four back to back, overall band at the end", { nav.requireSignIn("Sign in to take a full mock test.") { nav.go(MockStart) } }, icon = R.drawable.ic_lr_flag)
                RowDivider()
                NavRow("Prompt bank", "Browse every question and task, no account needed", { nav.go(Bank("")) }, icon = R.drawable.ic_books)
            }
        }

        AppCard {
            SectionTitle("What a result looks like")
            Text("After each attempt you see the band for every criterion, then the exact words behind it.", style = MaterialTheme.typography.bodyMedium, color = e.muted)
            ExampleResult("Full mock test", "Mean of four sections", 7.0, mockExample)
            ExampleResult("Speaking, Part 2", "Speaking, Part 2", 6.5, speakingExample)
        }

        AppCard {
            SectionTitle("Free to try")
            Text(
                "Try speaking and writing tests as a guest. Create a free account for more tests. Subscribers get unlimited speaking and writing. Listening and Reading are free.",
                style = MaterialTheme.typography.bodyLarge, color = e.muted,
            )
            Text("History, mistakes and the review deck need an account.", style = MaterialTheme.typography.bodyMedium, color = e.ink)
            Row(Modifier.offset(x = (-12).dp), verticalAlignment = Alignment.CenterVertically) {
                LinkButton("Create one", { nav.openLogin("Create an account to save your practice.", signUp = true) })
                LinkButton("Sign in", { nav.openLogin("Sign in to continue your practice.") })
            }
        }

        QuotaSummary(nav)

        AppCard {
            SectionTitle("What you get")
            features.forEach { f ->
                Row(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.Top) {
                    Icon(painterResource(f.icon), null, Modifier.size(24.dp), tint = e.muted)
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(f.title, style = MaterialTheme.typography.titleMedium, color = e.ink)
                        Text(f.body, style = MaterialTheme.typography.bodyMedium, color = e.muted)
                    }
                }
            }
        }
    }
}

/** One labelled example: heading, "not a real score" chip, the overall band and a bar per row. */
@Composable
private fun ExampleResult(title: String, caption: String, overall: Double, rows: List<Pair<String, Double>>) {
    val e = MaterialTheme.ext
    Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Top) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(title, style = MaterialTheme.typography.titleMedium, color = e.ink)
                Chip("Example, not a real score")
                Text(caption, style = MaterialTheme.typography.bodySmall, color = e.muted)
            }
            BigNumber(Band.format(overall), Modifier.clearAndSetSemantics { contentDescription = "Example band ${Band.format(overall)}" })
        }
        rows.forEach { (name, band) ->
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
}
