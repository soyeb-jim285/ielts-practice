package com.soyeb.ieltspractice.core

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.serializer

/** Lenient decoding for every API response: unknown keys ignored, nulls/bad enums fall back to defaults. */
val AppJson = Json {
    ignoreUnknownKeys = true
    coerceInputValues = true
    isLenient = true
    explicitNulls = false
    encodeDefaults = true
}

/** The keys a list response may be wrapped in (port of iOS `ListOf`). */
private val listKeys = listOf("items", "cards", "models", "data")

/** Accepts a bare array or `{ items | cards | models | data: [...] }`. */
fun <T> Json.decodeList(serializer: KSerializer<T>, text: String): List<T> {
    val root = parseToJsonElement(text)
    val array = when (root) {
        is JsonArray -> root
        is JsonObject -> listKeys.firstNotNullOfOrNull { root[it] as? JsonArray }
        else -> null
    } ?: throw SerializationException("Expected a list")
    return array.map { decodeFromJsonElement(serializer, it) }
}

inline fun <reified T> Json.decodeList(text: String): List<T> = decodeList(serializer<T>(), text)
