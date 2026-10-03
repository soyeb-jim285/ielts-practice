package com.soyeb.ieltspractice.ui.screens.writing

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import com.soyeb.ieltspractice.LocalApp
import com.soyeb.ieltspractice.core.Prompt
import com.soyeb.ieltspractice.ui.theme.AppText
import com.soyeb.ieltspractice.ui.theme.ext

/** Exam-paper rendering of a writing prompt: instructions, the figure (chart JSON or a Cambridge image), letter bullets (web PromptPanel, iOS promptView). */
@Composable
fun PromptContent(p: Prompt, modifier: Modifier = Modifier) {
    val e = MaterialTheme.ext
    val chart = p.chartSpec
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text("${taskLabel(p)}. You should spend about ${if (p.part == 1) 20 else 40} minutes on this task.", style = MaterialTheme.typography.bodySmall, color = e.muted)
        if (showPromptTitle(p, chart?.title)) Text(p.title, style = MaterialTheme.typography.titleLarge, color = e.ink)
        Text(p.body, style = AppText.reading, color = e.ink)
        if (!p.bullets.isNullOrEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("In your letter", style = AppText.reading, color = e.ink)
                p.bullets.forEach { b ->
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("•", style = AppText.reading, color = e.muted)
                        Text(b, style = AppText.reading, color = e.ink)
                    }
                }
            }
        }
        if (chart != null) ChartView(chart) else p.imageUrl?.let { RemoteFigure(it, "Figure for: ${p.title}") }
        HorizontalDivider(color = e.line)
        Text("Write at least ${minWords(p.part)} words.", style = MaterialTheme.typography.bodySmall, color = e.muted)
        letterOpening(p)?.let {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("You do NOT need to write any addresses.", style = AppText.reading, color = e.ink)
                Text("Begin your letter as follows:", style = AppText.reading, color = e.ink)
                Text(it, style = AppText.reading, color = e.ink)
            }
        }
    }
}

/** A raster exam figure. They are drawn on white, so the frame stays white in dark mode on purpose (DESIGN.md, Surfaces). */
@Composable
private fun RemoteFigure(url: String, description: String) {
    val api = LocalApp.current.api
    val bitmap by produceState<Result<Bitmap>?>(null, url) {
        value = runCatching {
            val bytes = api.download(if (url.startsWith("/")) api.baseUrl + url else url)
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            var sample = 1
            while (bounds.outWidth / sample > 1600) sample *= 2
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })!!
        }
    }
    Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Color.White).padding(8.dp).heightIn(min = 120.dp), contentAlignment = Alignment.Center) {
        when (val r = bitmap) {
            null -> CircularProgressIndicator(color = MaterialTheme.ext.brand)
            else -> r.fold(
                { Image(it.asImageBitmap(), description, Modifier.fillMaxWidth(), contentScale = ContentScale.FillWidth) },
                { Text("Couldn't load the figure", style = MaterialTheme.typography.bodySmall, color = Color(0xFF475569)) },
            )
        }
    }
}
