package com.soyeb.ieltspractice.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LargeTopAppBar
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.soyeb.ieltspractice.LocalDemo
import com.soyeb.ieltspractice.ui.theme.ext
import kotlinx.coroutines.flow.first

/**
 * The frame every screen uses: a top app bar on the app canvas, 16dp side gutters, 12dp between blocks.
 * - Tab roots: `large = true` (collapsing serif title, like the iOS large title), no [onBack].
 * - Pushed screens: small title bar with a back arrow (`onBack = nav::back`).
 * - [scroll] = false when the body is a LazyColumn/own scroller (give it `Modifier.weight(1f)`).
 * The bottom navigation bar and insets are handled by AppNavHost; do not add them here.
 */
@Composable
fun ScreenScaffold(
    title: String,
    modifier: Modifier = Modifier,
    large: Boolean = false,
    onBack: (() -> Unit)? = null,
    actions: @Composable RowScope.() -> Unit = {},
    scroll: Boolean = true,
    content: @Composable ColumnScope.() -> Unit,
) {
    val e = MaterialTheme.ext
    val behavior = if (large) TopAppBarDefaults.exitUntilCollapsedScrollBehavior() else TopAppBarDefaults.pinnedScrollBehavior()
    val colors = TopAppBarDefaults.topAppBarColors(
        containerColor = e.bg, scrolledContainerColor = e.bg,
        titleContentColor = e.ink, navigationIconContentColor = e.ink, actionIconContentColor = e.ink,
    )
    val titleText: @Composable () -> Unit = { Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis) }
    val back: @Composable () -> Unit = {
        if (onBack != null) {
            IconButton(onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
        }
    }
    Scaffold(
        modifier.nestedScroll(behavior.nestedScrollConnection),
        containerColor = e.bg,
        topBar = {
            if (large) LargeTopAppBar(titleText, navigationIcon = back, actions = actions, colors = colors, scrollBehavior = behavior)
            else TopAppBar(titleText, navigationIcon = back, actions = actions, colors = colors, scrollBehavior = behavior)
        },
    ) { pad ->
        val scrollState = rememberScrollState()
        // Screenshots: a demo `tab` ending in "+end" opens scrolled to the bottom, so long screens can be captured in parts (iOS `-anchor bottom`).
        if (LocalDemo.current?.tab?.endsWith("+end") == true) LaunchedEffect(Unit) { snapshotFlow { scrollState.maxValue }.first { it > 0 }.let { scrollState.scrollTo(it) } }
        Column(
            Modifier.fillMaxSize().padding(pad)
                .then(if (scroll) Modifier.verticalScroll(scrollState) else Modifier)
                .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            content = content,
        )
    }
}
