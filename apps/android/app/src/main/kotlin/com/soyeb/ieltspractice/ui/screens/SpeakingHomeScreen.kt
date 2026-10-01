package com.soyeb.ieltspractice.ui.screens

import androidx.compose.runtime.Composable
import com.soyeb.ieltspractice.ui.nav.AppNav

// Mirrors: iOS Views/SpeakingHomeView.swift, web routes/_app/speaking/index.tsx

@Composable
fun SpeakingHomeScreen(nav: AppNav) {
    PlaceholderScreen("Speaking", nav, ios = "Views/SpeakingHomeView.swift", web = "routes/_app/speaking/index.tsx", root = true)
}
