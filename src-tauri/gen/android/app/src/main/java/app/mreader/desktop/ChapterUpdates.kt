package app.mreader.desktop

import eu.kanade.tachiyomi.source.Source
import eu.kanade.tachiyomi.source.model.SManga

/** Details and covers have their own requests; their parsers must not block reading. */
internal suspend fun chapterUpdate(source: Source, manga: SManga) =
    source.getMangaUpdate(manga, emptyList(), fetchDetails = false, fetchChapters = true)
