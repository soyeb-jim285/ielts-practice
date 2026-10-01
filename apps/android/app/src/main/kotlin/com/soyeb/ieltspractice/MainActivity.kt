package com.soyeb.ieltspractice

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.soyeb.ieltspractice.core.DemoConfig
import com.soyeb.ieltspractice.ui.IeltsApp

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val demo = DemoConfig.from(intent) // `--ez demo true --es screen ... --es theme dark` (see core/Demo.kt)
        val container = if (demo != null) AppContainer(this, demo) else (application as IeltsApplication).container
        setContent { IeltsApp(container, demo) }
    }
}
