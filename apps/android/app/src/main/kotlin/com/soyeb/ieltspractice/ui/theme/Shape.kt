package com.soyeb.ieltspractice.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Shapes
import androidx.compose.ui.unit.dp

/** Cards are 16dp (with a 1dp `line` border, see AppCard); controls (buttons, fields, segmented) are 8dp. */
val CardShape = RoundedCornerShape(16.dp)
val ControlShape = RoundedCornerShape(8.dp)

val AppShapes = Shapes(
    extraSmall = RoundedCornerShape(4.dp),
    small = ControlShape,
    medium = ControlShape,
    large = CardShape,
    extraLarge = RoundedCornerShape(20.dp), // dialogs, sheets
)
