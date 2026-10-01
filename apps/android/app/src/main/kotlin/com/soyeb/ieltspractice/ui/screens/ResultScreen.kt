package com.soyeb.ieltspractice.ui.screens

import androidx.compose.runtime.Composable
import com.soyeb.ieltspractice.ui.nav.AppNav
import com.soyeb.ieltspractice.ui.nav.AttemptResult

// Mirrors: iOS Views/ResultView.swift (+ FluencyView, TranscriptView, ChartView), web routes/_app/speaking/result.$attemptId.tsx, _app/writing/result.$attemptId.tsx

@Composable
fun ResultScreen(route: AttemptResult, nav: AppNav) {
    PlaceholderScreen("Result", nav, ios = "Views/ResultView.swift (+ FluencyView, TranscriptView, ChartView)", web = "routes/_app/speaking/result.\$attemptId.tsx, _app/writing/result.\$attemptId.tsx")
}
