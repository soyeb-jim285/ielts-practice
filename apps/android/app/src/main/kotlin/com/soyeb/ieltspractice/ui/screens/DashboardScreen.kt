package com.soyeb.ieltspractice.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.unit.dp
import com.soyeb.ieltspractice.LocalApp
import com.soyeb.ieltspractice.core.ProgressData
import com.soyeb.ieltspractice.ui.LoadContent
import com.soyeb.ieltspractice.ui.rememberLoad
import com.soyeb.ieltspractice.ui.nav.AppNav
import com.soyeb.ieltspractice.ui.theme.AppCard
import com.soyeb.ieltspractice.ui.theme.BandPill
import com.soyeb.ieltspractice.ui.theme.ChipRow
import com.soyeb.ieltspractice.ui.theme.SectionTitle
import com.soyeb.ieltspractice.ui.theme.ext

// Mirrors: iOS Views/DashboardView.swift, web routes/_app/index.tsx

@Composable
fun DashboardScreen(nav: AppNav) {
    PlaceholderScreen("Home", nav, ios = "Views/DashboardView.swift", web = "routes/_app/index.tsx", root = true) {
        // TODO(android): replace PlaceholderScreen with the real dashboard. This block is the data-loading pattern to copy:
        // rememberLoad + api.get + LoadContent, and the shared components (SectionTitle, AppCard, BandPill, ChipRow).
        if (LocalApp.current.api.token.collectAsState().value != null) ProgressExample()
    }
}

@Composable
private fun ProgressExample() {
    val api = LocalApp.current.api
    val progress = rememberLoad { api.get<ProgressData>("/api/progress") }
    LoadContent(progress) { p ->
        AppCard {
            SectionTitle("Predicted band")
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                p.predicted.speaking?.let { Text("Speaking", color = MaterialTheme.ext.muted); BandPill(it) }
                p.predicted.writing?.let { Text("Writing", color = MaterialTheme.ext.muted); BandPill(it) }
            }
            ChipRow(listOf("${p.streak}-day streak", "${p.attempts} attempts", "${p.minutesThisWeek.toInt()} min this week"))
        }
    }
}
