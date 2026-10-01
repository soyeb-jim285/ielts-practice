package com.soyeb.ieltspractice.ui.screens

import androidx.compose.runtime.Composable
import com.soyeb.ieltspractice.ui.nav.AppNav

// Mirrors: iOS Views/LiveExamView.swift, web routes/_app/speaking/live.tsx, live/

@Composable
fun LiveExamScreen(nav: AppNav) {
    PlaceholderScreen("Live exam", nav, ios = "Views/LiveExamView.swift", web = "routes/_app/speaking/live.tsx, live/")
}
