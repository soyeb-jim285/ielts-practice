package com.soyeb.ieltspractice.ui.screens

import androidx.compose.runtime.Composable
import com.soyeb.ieltspractice.ui.nav.AppNav
import com.soyeb.ieltspractice.ui.nav.WritingEditor

// Mirrors: iOS Views/WritingEditorView.swift, web routes/_app/writing/task.$promptId.tsx, _app/writing/full.tsx

@Composable
fun WritingEditorScreen(route: WritingEditor, nav: AppNav) {
    PlaceholderScreen("Writing", nav, ios = "Views/WritingEditorView.swift", web = "routes/_app/writing/task.\$promptId.tsx, _app/writing/full.tsx")
}
