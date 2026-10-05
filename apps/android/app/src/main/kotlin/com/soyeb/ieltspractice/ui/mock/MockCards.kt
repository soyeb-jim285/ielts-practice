package com.soyeb.ieltspractice.ui.mock

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
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
import androidx.compose.ui.unit.dp
import com.soyeb.ieltspractice.LocalApp
import com.soyeb.ieltspractice.LocalDemo
import com.soyeb.ieltspractice.R
import com.soyeb.ieltspractice.core.Mock
import com.soyeb.ieltspractice.core.MockFlow
import com.soyeb.ieltspractice.core.mockCurrent
import com.soyeb.ieltspractice.ui.nav.AppNav
import com.soyeb.ieltspractice.ui.nav.MockHub
import com.soyeb.ieltspractice.ui.nav.MockStart
import com.soyeb.ieltspractice.ui.theme.AppCard
import com.soyeb.ieltspractice.ui.theme.ext

// Mirrors: web components/mock/MockCta.tsx. The "Full mock test" entry on Home and on the four skill hubs; "Continue your mock test" while one is open.

/** One tappable card. Looks up the open mock for an account (quietly: no card change on failure); a guest is sent to sign in first. */
@Composable
fun MockCta(nav: AppNav, modifier: Modifier = Modifier) {
    val e = MaterialTheme.ext
    val api = LocalApp.current.api
    val account by api.hasAccount.collectAsState()
    val demo = LocalDemo.current
    val open by produceState<Mock?>(null, account) { value = if (account && demo == null) runCatching { api.mockCurrent() }.getOrNull() else null }
    val m = open
    AppCard(modifier, onClick = { if (m != null) nav.go(MockHub(m.id)) else nav.requireSignIn("Sign in to take a full mock test.") { nav.go(MockStart) } }) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(painterResource(R.drawable.ic_books), contentDescription = null, Modifier.size(24.dp), tint = e.brand)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(if (m != null) "Continue your mock test" else "Full mock test", style = MaterialTheme.typography.titleSmall, color = e.ink)
                Text(
                    if (m != null) MockFlow.continueLine(m) else "Listening, Reading, Writing and Speaking in one go, with an overall band.",
                    style = MaterialTheme.typography.bodySmall, color = e.muted,
                )
            }
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, Modifier.size(20.dp), tint = e.muted)
        }
    }
}
