package com.soyeb.ieltspractice.ui.screens

import androidx.compose.runtime.Composable
import com.soyeb.ieltspractice.ui.nav.AppNav

// Mirrors: iOS Views/ReviewView.swift, web routes/_app/review.tsx

@Composable
fun ReviewScreen(nav: AppNav) {
    PlaceholderScreen("Review", nav, ios = "Views/ReviewView.swift", web = "routes/_app/review.tsx", root = true)
}
