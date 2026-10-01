package com.soyeb.ieltspractice.ui.screens

import androidx.compose.runtime.Composable
import com.soyeb.ieltspractice.ui.nav.AppNav
import com.soyeb.ieltspractice.ui.nav.Mistakes

// Mirrors: iOS Views/MistakesView.swift, web routes/_app/mistakes.tsx

@Composable
fun MistakesScreen(route: Mistakes, nav: AppNav) {
    PlaceholderScreen("Mistakes", nav, ios = "Views/MistakesView.swift", web = "routes/_app/mistakes.tsx")
}
