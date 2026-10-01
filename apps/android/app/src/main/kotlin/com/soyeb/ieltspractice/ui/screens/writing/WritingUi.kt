package com.soyeb.ieltspractice.ui.screens.writing

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.soyeb.ieltspractice.ui.theme.ControlShape
import com.soyeb.ieltspractice.ui.theme.ext

/** A two-or-three way segmented control: the selected segment is the soft brand pill ("you are here"). */
@Composable
fun Segmented(options: List<Pair<String, String>>, selected: String, onSelect: (String) -> Unit, modifier: Modifier = Modifier) {
    val e = MaterialTheme.ext
    SingleChoiceSegmentedButtonRow(modifier.fillMaxWidth()) {
        options.forEachIndexed { i, (key, label) ->
            SegmentedButton(
                selected = key == selected,
                onClick = { onSelect(key) },
                shape = SegmentedButtonDefaults.itemShape(i, options.size, ControlShape),
                modifier = Modifier.heightIn(min = 48.dp),
                icon = {},
                colors = SegmentedButtonDefaults.colors(
                    activeContainerColor = e.brandSoft, activeContentColor = e.brand, activeBorderColor = e.brand,
                    inactiveContainerColor = e.surface, inactiveContentColor = e.ink, inactiveBorderColor = MaterialTheme.colorScheme.outline,
                ),
                label = { Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            )
        }
    }
}
