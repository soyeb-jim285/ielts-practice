package com.soyeb.ieltspractice.ui.screens

import androidx.compose.runtime.Composable
import com.soyeb.ieltspractice.ui.nav.AppNav

// Mirrors: iOS Views/WritingHomeView.swift, web routes/_app/writing/index.tsx

@Composable
fun WritingHomeScreen(nav: AppNav) {
    PlaceholderScreen("Writing", nav, ios = "Views/WritingHomeView.swift", web = "routes/_app/writing/index.tsx", root = true)
}
