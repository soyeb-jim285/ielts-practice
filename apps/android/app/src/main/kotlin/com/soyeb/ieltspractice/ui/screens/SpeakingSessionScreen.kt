package com.soyeb.ieltspractice.ui.screens

import androidx.compose.runtime.Composable
import com.soyeb.ieltspractice.ui.nav.AppNav
import com.soyeb.ieltspractice.ui.nav.SpeakingSession

// Mirrors: iOS Views/SpeakingSessionView.swift, web routes/_app/speaking/session.tsx

@Composable
fun SpeakingSessionScreen(route: SpeakingSession, nav: AppNav) {
    PlaceholderScreen("Speaking", nav, ios = "Views/SpeakingSessionView.swift", web = "routes/_app/speaking/session.tsx")
}
