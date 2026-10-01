package com.soyeb.ieltspractice.ui.screens

import androidx.compose.runtime.Composable
import com.soyeb.ieltspractice.ui.nav.AppNav

// Mirrors: iOS Views/LoginView.swift, web routes/login.tsx, signup.tsx, forgot-password.tsx

@Composable
fun LoginScreen(nav: AppNav) {
    PlaceholderScreen("Sign in", nav, ios = "Views/LoginView.swift", web = "routes/login.tsx, signup.tsx, forgot-password.tsx")
}
