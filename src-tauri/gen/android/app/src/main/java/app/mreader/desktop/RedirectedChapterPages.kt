package app.mreader.desktop

import eu.kanade.tachiyomi.source.model.Page
import eu.kanade.tachiyomi.source.model.SChapter
import eu.kanade.tachiyomi.source.online.HttpSource
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Request
import org.jsoup.Jsoup

/** Recognize only the observed reader layout, never arbitrary page images. */
internal fun redirectedChapterImages(html: String, baseUrl: String): List<Page> {
    val images = Jsoup.parse(html, baseUrl)
        .select("div.touch-manipulation.select-none > div.flex-col > div.group > img")
    if (images.size !in 2..1000) return emptyList()
    val urls = images.map { it.absUrl("src").toHttpUrlOrNull() ?: return emptyList() }
    if (urls.any { !it.isHttps || it.username.isNotEmpty() || it.password.isNotEmpty() }) return emptyList()
    val file = Regex("^(.*)/(\\d+)\\.(?:webp|png|jpe?g|avif)$", RegexOption.IGNORE_CASE)
    val matches = urls.map { file.matchEntire(it.encodedPath) ?: return emptyList() }
    val start = matches.first().groupValues[2].toIntOrNull() ?: return emptyList()
    if (start !in 0..1) return emptyList()
    if (urls.indices.any { i ->
        urls[i].host != urls[0].host || urls[i].port != urls[0].port ||
        matches[i].groupValues[1] != matches[0].groupValues[1] ||
        matches[i].groupValues[2].toIntOrNull() != start + i
    }) return emptyList()
    return urls.mapIndexed { index, url -> Page(index, imageUrl = url.toString()) }
}

internal fun redirectedChapterPages(source: HttpSource, chapter: SChapter): List<Page> {
    val url = source.getChapterUrl(chapter).toHttpUrlOrNull() ?: return emptyList()
    if (!url.isHttps || url.username.isNotEmpty() || url.password.isNotEmpty()) return emptyList()
    // The installed source's normal client retains verification, headers and TLS checks.
    return source.client.newCall(Request.Builder().url(url).headers(source.headers).build()).execute().use { response ->
        check(response.isSuccessful) { "Source page HTTP ${response.code}" }
        if (!response.request.url.isHttps || response.body.contentLength() > 8L * 1024 * 1024) return@use emptyList()
        val output = java.io.ByteArrayOutputStream()
        response.body.byteStream().use { input ->
            val buffer = ByteArray(8192)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                check(output.size() + count <= 8 * 1024 * 1024) { "Source page exceeds 8 MiB" }
                output.write(buffer, 0, count)
            }
        }
        val bytes = output.toByteArray()
        redirectedChapterImages(bytes.toString(Charsets.UTF_8), response.request.url.toString())
    }
}
