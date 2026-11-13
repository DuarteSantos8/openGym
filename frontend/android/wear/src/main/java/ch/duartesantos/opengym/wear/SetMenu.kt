package ch.duartesantos.opengym.wear

import kotlinx.serialization.Serializable

/** A set-menu edit made here that the phone's snapshot has not shown yet (SetMenu.swift PendingEdit). */
@Serializable
data class PendingEdit(
    val id: String,
    val exId: String,
    /** "mark" | "add" | "remove" */
    val op: String,
    val setIdx: Int? = null,
    /** "warmup" | "failure" | "drop" */
    val kind: String? = null,
    val on: Boolean? = null,
    val w: Double? = null,
    val r: Double? = null,
    val done: Boolean? = null,
    val entryIdx: Int? = null,
)
