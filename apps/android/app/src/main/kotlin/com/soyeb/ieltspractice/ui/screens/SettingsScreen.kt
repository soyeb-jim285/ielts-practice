package com.soyeb.ieltspractice.ui.screens

import androidx.compose.runtime.Composable
import com.soyeb.ieltspractice.ui.nav.AppNav

// Mirrors: iOS Views/SettingsView.swift, web routes/_app/settings.tsx

@Composable
fun SettingsScreen(nav: AppNav) {
    PlaceholderScreen("Settings", nav, ios = "Views/SettingsView.swift", web = "routes/_app/settings.tsx", root = true)
}
