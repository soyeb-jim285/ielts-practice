package com.soyeb.ieltspractice.ui.screens

import androidx.compose.runtime.Composable
import com.soyeb.ieltspractice.ui.nav.AppNav
import com.soyeb.ieltspractice.ui.nav.Bank

// Mirrors: iOS Views/BankView.swift, web routes/_app/bank.tsx

@Composable
fun BankScreen(route: Bank, nav: AppNav) {
    PlaceholderScreen("Prompt bank", nav, ios = "Views/BankView.swift", web = "routes/_app/bank.tsx")
}
