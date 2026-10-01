package com.soyeb.ieltspractice.ui.screens

import androidx.compose.runtime.Composable
import com.soyeb.ieltspractice.ui.nav.AppNav
import com.soyeb.ieltspractice.ui.nav.History

// Mirrors: iOS Views/HistoryView.swift, web routes/_app/history.tsx

@Composable
fun HistoryScreen(route: History, nav: AppNav) {
    PlaceholderScreen("History", nav, ios = "Views/HistoryView.swift", web = "routes/_app/history.tsx")
}
