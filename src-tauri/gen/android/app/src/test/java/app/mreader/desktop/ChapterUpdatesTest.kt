package app.mreader.desktop

import eu.kanade.tachiyomi.source.online.HttpSource
import eu.kanade.tachiyomi.source.model.*
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class ChapterUpdatesTest {
    private open class Fixture : HttpSource() {
        override val name = "Parser isolation fixture"
        override val lang = "en"
        override val supportsLatest = false
        override val baseUrl = "https://example.test"
        val chapter = SChapter.create().apply {
            url = "/title/chapter-1"; name = "Chapter 1"; chapter_number = 1f
            memo = buildJsonObject { put("pageKey", "fixture-key") }
        }
        override suspend fun getMangaUpdate(manga: SManga, chapters: List<SChapter>, fetchDetails: Boolean, fetchChapters: Boolean): SMangaUpdate {
            if (fetchDetails) throw NullPointerException("Source detail parser has no thumbnail element")
            check(fetchChapters)
            return SMangaUpdate(manga, listOf(chapter))
        }
        override suspend fun getPageList(chapter: SChapter): List<Page> {
            check(chapter.memo["pageKey"]?.jsonPrimitive?.content == "fixture-key")
            return listOf(Page(0, imageUrl = "$baseUrl/page-1.jpg"), Page(1, imageUrl = "$baseUrl/page-2.jpg"))
        }
    }

    @Test fun brokenDetailParserDoesNotBlockChaptersOrPageContext() = runBlocking {
        val source = Fixture()
        val manga = SManga.create().apply { url = "/title"; title = "Fixture" }
        try { source.getMangaUpdate(manga, emptyList(), true, true); fail("Fixture must reproduce detail failure") }
        catch (_: NullPointerException) {}
        val update = chapterUpdate(source, manga)
        assertSame(manga, update.manga)
        assertEquals("/title/chapter-1", update.chapters.single().url)
        assertSame(source.chapter.memo, update.chapters.single().memo)
        assertEquals(2, source.getPageList(update.chapters.single()).size)
    }

    @Test fun chapterErrorsStillReachTheReader() = runBlocking {
        val expected = IllegalStateException("Browser verification required")
        val source = object : Fixture() {
            override suspend fun getMangaUpdate(manga: SManga, chapters: List<SChapter>, fetchDetails: Boolean, fetchChapters: Boolean): SMangaUpdate = throw expected
        }
        try { chapterUpdate(source, SManga.create()); fail("Chapter error must not be hidden") }
        catch (actual: IllegalStateException) { assertSame(expected, actual) }
    }
}
