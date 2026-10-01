package com.soyeb.ieltspractice.ui.screens.shell

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.soyeb.ieltspractice.core.ApiError
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

class PageResult<T>(val items: List<T>, val total: Int)

/**
 * An infinite list: [reset] loads page 1 (dropping stale answers from an earlier filter), [more] appends the next page.
 * [fetch] gets the 1-based page number and reads the screen's current filters. Used by the bank, history and mistakes.
 */
class Paged<T>(private val scope: CoroutineScope, private val fetch: suspend (page: Int) -> PageResult<T>) {
    var items by mutableStateOf(emptyList<T>()); private set
    var total by mutableStateOf<Int?>(null); private set
    var loading by mutableStateOf(true); private set
    var error by mutableStateOf<String?>(null); private set
    val hasMore: Boolean get() = error == null && items.size < (total ?: 0)

    private var page = 1
    private var generation = 0
    private var job: Job? = null

    fun reset() {
        generation++
        job?.cancel()
        page = 1
        run(true)
    }

    fun more() { if (!loading && hasMore) run(false) }

    private fun run(replace: Boolean) {
        val gen = generation
        loading = true
        job = scope.launch {
            try {
                val r = fetch(page)
                if (gen != generation) return@launch
                items = if (replace) r.items else items + r.items
                total = r.total
                page++
                error = null
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (gen != generation) return@launch
                error = if (e is ApiError) e.message else e.message ?: "Something went wrong."
                total = items.size // stop auto-paging until retry
            } finally {
                if (gen == generation) loading = false
            }
        }
    }

    /** Edit a loaded item in place (e.g. a mistake that just joined the deck). */
    fun update(transform: (T) -> T) { items = items.map(transform) }
}
