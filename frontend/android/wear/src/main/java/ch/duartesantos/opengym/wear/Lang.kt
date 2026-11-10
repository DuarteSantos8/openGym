package ch.duartesantos.opengym.wear

import android.content.Context
import android.content.res.Configuration
import java.util.Locale

/**
 * The watch speaks the app's language (the snapshot's settings.lang, lib/watch-sync.js watchExtras),
 * not the watch's own, as the Apple Watch does: a phone in English never gets a German watch.
 */
object Lang {
    /** The app's language code → a Locale whose resources this app has (values-*). */
    fun localeOf(lang: String?): Locale? = when (lang) {
        null, "" -> null
        "pt" -> Locale.forLanguageTag("pt-PT")
        "pt-BR" -> Locale.forLanguageTag("pt-BR")
        "zh" -> Locale.forLanguageTag("zh-CN")
        "zh-TW" -> Locale.forLanguageTag("zh-TW")
        else -> Locale.forLanguageTag(lang)
    }

    fun wrap(base: Context, lang: String?): Context {
        val locale = localeOf(lang) ?: return base
        val config = Configuration(base.resources.configuration)
        config.setLocale(locale)
        config.setLayoutDirection(locale)
        return base.createConfigurationContext(config)
    }
}
