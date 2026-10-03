package com.soyeb.ieltspractice.ui.screens.lr

import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.background
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.material3.Icon
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.media3.exoplayer.ExoPlayer
import com.soyeb.ieltspractice.LocalDemo
import com.soyeb.ieltspractice.R
import com.soyeb.ieltspractice.audio.AudioPlayer
import com.soyeb.ieltspractice.core.LISTENING_REVIEW_SECONDS
import com.soyeb.ieltspractice.core.clock
import com.soyeb.ieltspractice.ui.screens.shell.Segmented
import com.soyeb.ieltspractice.ui.theme.AppText
import com.soyeb.ieltspractice.ui.theme.PrimaryButton
import com.soyeb.ieltspractice.ui.theme.SecondaryButton
import com.soyeb.ieltspractice.ui.theme.ext
import kotlinx.coroutines.delay
import kotlin.math.ceil
import kotlin.math.max

// Mirrors: web components/lr/Audio.tsx. Media3 ExoPlayer streams the presigned URLs (Range supported).

/** Practice / review player state: play, scrub, speed. In demo mode there is no engine, only a fixed spot, so screenshots need no audio. */
@Stable
class LrPlayer(private val demo: Boolean) {
    var playing by mutableStateOf(false)
        private set
    var position by mutableDoubleStateOf(if (demo) 87.0 else 0.0)
        private set
    var duration by mutableDoubleStateOf(if (demo) 412.0 else 0.0)
        private set
    var speed by mutableFloatStateOf(1f)
        private set
    var failed by mutableStateOf(false)
        private set
    private var engine: AudioPlayer? = null

    fun load(context: Context, url: String) {
        if (demo || engine != null) return
        engine = AudioPlayer(context).also { it.load(url) }
    }

    suspend fun poll() {
        val e = engine ?: return
        var waited = 0
        while (true) {
            playing = e.playing.value
            position = e.positionMs / 1000.0
            val d = e.durationMs / 1000.0
            if (d > 0) duration = d else if (duration == 0.0 && ++waited > 80) failed = true
            delay(if (playing) 200 else 400)
        }
    }

    fun toggle() { if (playing) { engine?.pause(); playing = false } else { engine?.play(); if (engine != null) playing = true } }
    fun seek(t: Double) {
        val v = t.coerceIn(0.0, if (duration > 0) duration else max(t, 0.0))
        position = v
        engine?.seekTo((v * 1000).toLong())
    }
    fun replay() { seek(0.0); if (!playing) toggle() }
    fun setSpeed(s: Float) { speed = s; engine?.setSpeed(s) }
    fun release() { engine?.release(); engine = null }
}

@Composable
private fun RoundButton(icon: Int, label: String, onClick: () -> Unit, enabled: Boolean = true) {
    val e = MaterialTheme.ext
    Box(
        Modifier.size(48.dp).background(if (enabled) e.brand else e.surface2, CircleShape)
            .clickable(enabled, role = Role.Button, onClick = onClick).semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) { Icon(painterResource(icon), null, Modifier.size(24.dp), tint = if (enabled) e.onBrand else e.muted) }
}

@Composable
private fun SkipButton(text: String, label: String, onClick: () -> Unit) {
    Box(
        Modifier.size(48.dp).clickable(role = Role.Button, onClick = onClick).semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) { Text(text, style = MaterialTheme.typography.labelLarge.merge(AppText.num), color = MaterialTheme.ext.ink) }
}

/** Practice and review player: play, scrub, 5 s back and forward, speed 0.75 / 1 / 1.25, replay the part. */
@Composable
fun PracticeAudio(src: String, label: String, modifier: Modifier = Modifier) {
    val e = MaterialTheme.ext
    val context = LocalContext.current
    val demo = LocalDemo.current != null
    val player = remember(src) { LrPlayer(demo) }
    LaunchedEffect(player) { if (src.isNotEmpty()) { player.load(context, src); player.poll() } }
    DisposableEffect(player) { onDispose { player.release() } }
    Column(modifier.fillMaxWidth().semantics { contentDescription = "$label audio" }, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            SkipButton("-5", "Back 5 seconds") { player.seek(player.position - 5) }
            RoundButton(if (player.playing) R.drawable.ic_lr_pause else R.drawable.ic_lr_play, if (player.playing) "Pause $label" else "Play $label", player::toggle, enabled = !player.failed)
            SkipButton("+5", "Forward 5 seconds") { player.seek(player.position + 5) }
            Box(Modifier.weight(1f))
            TextButton(player::replay, Modifier.heightIn(min = 48.dp)) { Text("Replay ${label.lowercase()}", color = e.brand, style = MaterialTheme.typography.labelLarge) }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(clock(player.position.toInt()), Modifier.widthIn(min = 40.dp), style = MaterialTheme.typography.labelMedium.merge(AppText.num), color = e.muted, textAlign = TextAlign.End)
            Slider(
                value = if (player.duration > 0) (player.position / player.duration).toFloat().coerceIn(0f, 1f) else 0f,
                onValueChange = { if (player.duration > 0) player.seek(it * player.duration) },
                modifier = Modifier.weight(1f).heightIn(min = 48.dp).semantics { contentDescription = "Seek"; stateDescription = "${clock(player.position.toInt())} of ${clock(player.duration.toInt())}" },
                colors = SliderDefaults.colors(thumbColor = e.brand, activeTrackColor = e.brand, inactiveTrackColor = e.surface2),
            )
            Text(clock(player.duration.toInt()), Modifier.widthIn(min = 40.dp), style = MaterialTheme.typography.labelMedium.merge(AppText.num), color = e.muted)
        }
        Segmented(
            listOf("0.75" to "0.75×", "1.0" to "1×", "1.25" to "1.25×"), if (player.speed == 1f) "1.0" else player.speed.toString(),
            { player.setSpeed(it.toFloat()) }, Modifier.semantics { contentDescription = "Playback speed" },
        )
        if (player.failed) Text("The recording could not be loaded. Check your connection.", style = MaterialTheme.typography.bodySmall, color = e.badText)
    }
}

enum class ExamPhase { Idle, Audio, Review }

/**
 * Exam listening: the recordings of all parts play once, in order, with no pause or seek for the learner. The clock IS the audio position
 * (a resumed attempt picks the recording up where it was), then a 2-minute review countdown runs on the wall clock.
 * In demo mode ([demoPhase] set) there is no engine; it sits in that phase at a fixed spot.
 */
@Stable
class ExamPlaylist(private val urls: List<String>, private val startElapsed: Double, private val demoPhase: ExamPhase? = null) {
    var durations by mutableStateOf<List<Double>?>(if (demoPhase != null) listOf(412.0, 405.0, 420.0, 398.0) else null)
        private set
    var error by mutableStateOf(false)
        private set
    var phase by mutableStateOf(demoPhase ?: ExamPhase.Idle)
        private set
    var idx by mutableIntStateOf(if (demoPhase == ExamPhase.Audio) 1 else 0)
        private set
    var elapsed by mutableDoubleStateOf(if (demoPhase == ExamPhase.Audio) 640.0 else if (demoPhase == ExamPhase.Review) 1635.0 + 38 else startElapsed)
        private set
    /** The system paused the recording (a call, headphones unplugged): offer to resume. */
    var stalled by mutableStateOf(false)
        private set
    private var exo: ExoPlayer? = null
    private var reviewStart = 0L

    val total: Double get() = durations?.sum() ?: 0.0
    val reviewLeft: Int get() = max(0, ceil(LISTENING_REVIEW_SECONDS - (elapsed - total)).toInt())
    private fun starts(): List<Double> = durations.orEmpty().runningFold(0.0) { a, d -> a + d }

    fun attach(context: Context) {
        if (demoPhase != null || exo != null || urls.isEmpty()) return
        val p = ExoPlayer.Builder(context.applicationContext)
            .setAudioAttributes(AudioAttributes.Builder().setContentType(C.AUDIO_CONTENT_TYPE_SPEECH).setUsage(C.USAGE_MEDIA).build(), true)
            .build()
        p.addListener(object : Player.Listener {
            override fun onTimelineChanged(timeline: Timeline, reason: Int) {
                if (timeline.isEmpty || timeline.windowCount != urls.size) return
                val w = Timeline.Window()
                val ds = (0 until timeline.windowCount).map { timeline.getWindow(it, w).durationMs }
                if (ds.all { it != C.TIME_UNSET }) durations = ds.map { it / 1000.0 }
            }
            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) { idx = p.currentMediaItemIndex }
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_ENDED && phase == ExamPhase.Audio) { reviewStart = System.currentTimeMillis(); phase = ExamPhase.Review }
            }
            override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) { if (!playWhenReady && phase == ExamPhase.Audio) stalled = true }
            override fun onPlayerError(e: PlaybackException) { error = true }
        })
        p.setMediaItems(urls.map { MediaItem.fromUri(it) })
        p.prepare()
        exo = p
    }

    fun start() {
        val d = durations ?: return
        val s = starts()
        stalled = false
        if (startElapsed >= total) {
            reviewStart = System.currentTimeMillis() - ((startElapsed - total) * 1000).toLong()
            phase = ExamPhase.Review
            return
        }
        var i = 0
        while (i < d.size - 1 && startElapsed >= s[i + 1]) i++
        idx = i
        phase = ExamPhase.Audio
        exo?.apply { seekTo(i, ((startElapsed - s[i]) * 1000).toLong()); playWhenReady = true }
    }

    fun resume() { stalled = false; exo?.playWhenReady = true }

    /** Keeps [elapsed] current (4 times a second) until the screen leaves. */
    suspend fun tick() {
        while (true) {
            if (demoPhase == null) {
                if (phase == ExamPhase.Audio) elapsed = starts().getOrElse(idx) { 0.0 } + (exo?.currentPosition ?: 0L) / 1000.0
                else if (phase == ExamPhase.Review) elapsed = total + (System.currentTimeMillis() - reviewStart) / 1000.0
            }
            delay(250)
        }
    }

    fun release() { exo?.release(); exo = null }
}

/** Exam recording bar: which part is playing and the whole-test progress. No transport controls on purpose. */
@Composable
fun ExamAudioBar(p: ExamPlaylist, modifier: Modifier = Modifier) {
    val e = MaterialTheme.ext
    Row(modifier.fillMaxWidth().semantics { contentDescription = "Recording" }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Icon(painterResource(R.drawable.ic_sp_headphones), null, Modifier.size(24.dp), tint = e.brand)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                if (p.phase == ExamPhase.Review) "Recording finished. Check your answers." else "Part ${p.idx + 1} of ${p.durations?.size ?: 4} is playing",
                style = MaterialTheme.typography.titleSmall, color = e.ink,
            )
            LinearProgressIndicator(
                progress = { if (p.total > 0) (p.elapsed / p.total).toFloat().coerceIn(0f, 1f) else 0f },
                Modifier.fillMaxWidth().semantics { contentDescription = "Recording progress" },
                color = e.brand, trackColor = e.surface2,
            )
        }
        if (p.stalled && p.phase == ExamPhase.Audio) SecondaryButton("Resume audio", p::resume)
    }
}

/** The start gate of a listening exam: nothing plays until the learner is ready. */
@Composable
fun ExamGate(p: ExamPlaylist, resumed: Boolean, onBack: () -> Unit, modifier: Modifier = Modifier) {
    val e = MaterialTheme.ext
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Icon(painterResource(R.drawable.ic_sp_headphones), null, Modifier.size(32.dp), tint = e.brand)
        Text(if (resumed) "Ready to continue?" else "Ready to listen?", style = MaterialTheme.typography.headlineSmall, color = e.ink)
        Text(
            "The recording plays once, from Part 1 to Part 4, with no pause or rewind. Questions appear as you start. You get 2 minutes at the end to check your answers, then the test submits itself.",
            style = MaterialTheme.typography.bodyLarge, color = e.ink,
        )
        Text("Check your volume first. Use headphones if you can.", style = MaterialTheme.typography.bodyMedium, color = e.muted)
        if (p.error) Text("The recording could not be loaded. Check your connection and reopen the test.", style = MaterialTheme.typography.bodyMedium, color = e.badText)
        PrimaryButton(if (resumed) "Resume test" else "Start test", p::start, Modifier.fillMaxWidth(), enabled = p.durations != null && !p.error)
        if (p.durations == null && !p.error) Text("Loading the recording...", style = MaterialTheme.typography.bodySmall, color = e.muted)
        SecondaryButton("Back", onBack, Modifier.fillMaxWidth())
    }
}
