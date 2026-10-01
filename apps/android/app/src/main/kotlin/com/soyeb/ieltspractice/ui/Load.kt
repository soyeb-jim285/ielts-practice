package com.soyeb.ieltspractice.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.soyeb.ieltspractice.core.ApiError
import com.soyeb.ieltspractice.ui.theme.ErrorLine
import com.soyeb.ieltspractice.ui.theme.SecondaryButton
import kotlinx.coroutines.CancellationException

sealed interface Load<out T> {
    data object Loading : Load<Nothing>
    data class Failed(val message: String) : Load<Nothing>
    data class Ready<T>(val value: T) : Load<T>
}

class Loader<T>(val state: Load<T>, val reload: () -> Unit)

/**
 * Run a suspend call when the screen enters (and again when [keys] change or [Loader.reload] is called).
 * ```
 * val api = LocalApp.current.api
 * val progress = rememberLoad { api.get<ProgressData>("/api/progress") }
 * LoadContent(progress) { p -> Text("Streak ${p.streak}") }
 * ```
 * Failures become [Load.Failed] with a user-safe message (ApiError messages are already written for display).
 */
@Composable
fun <T> rememberLoad(vararg keys: Any?, block: suspend () -> T): Loader<T> {
    var attempt by remember { mutableIntStateOf(0) }
    var state by remember { mutableStateOf<Load<T>>(Load.Loading) }
    val current by rememberUpdatedState(block)
    LaunchedEffect(*keys, attempt) {
        state = Load.Loading
        state = try {
            Load.Ready(current())
        } catch (e: CancellationException) {
            throw e
        } catch (e: ApiError) {
            Load.Failed(e.message)
        } catch (e: Exception) {
            Load.Failed(e.message ?: "Something went wrong.")
        }
    }
    return Loader(state) { attempt++ }
}

/** Spinner while loading, an error with Retry on failure, [content] when ready. */
@Composable
fun <T> LoadContent(loader: Loader<T>, modifier: Modifier = Modifier, content: @Composable (T) -> Unit) {
    when (val s = loader.state) {
        Load.Loading -> Column(modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            CircularProgressIndicator()
        }
        is Load.Failed -> Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            ErrorLine(s.message)
            SecondaryButton("Retry", loader.reload)
        }
        is Load.Ready -> content(s.value)
    }
}
