package app.mreader.desktop

import org.junit.Assert.*
import org.junit.Test

class RedirectedChapterPagesTest {
    private fun reader(vararg urls: String) = "<img src='https://example.test/cover.jpg'><div class='touch-manipulation select-none'><div class='flex-col'>" +
        urls.joinToString("") { "<div class='group'><img src='$it'></div>" } + "</div></div><img src='https://example.test/ad.jpg'>"
    @Test fun onlySequentialImagesInsideTheExactReaderArePages() {
        val pages = redirectedChapterImages(reader("https://images.test/title/1/0.webp", "https://images.test/title/1/1.webp"), "https://source.test/title/chapter-1")
        assertEquals(2, pages.size)
        assertEquals("https://images.test/title/1/0.webp", pages[0].imageUrl)
        assertEquals(1, pages[1].index)
    }
    @Test fun unrelatedMixedOrUnsafeImagesAreRejected() {
        for (html in listOf(
            "<img src='https://images.test/title/1/0.webp'><img src='https://images.test/title/1/1.webp'>",
            reader("https://images.test/title/1/0.webp", "https://images.test/advert/1.webp"),
            reader("https://images.test/title/1/0.webp", "https://other.test/title/1/1.webp"),
            reader("https://images.test/title/1/0.webp", "https://images.test/title/1/2.webp"),
            reader("http://images.test/title/1/0.webp", "http://images.test/title/1/1.webp")
        )) assertTrue(redirectedChapterImages(html, "https://source.test/chapter").isEmpty())
    }
}
