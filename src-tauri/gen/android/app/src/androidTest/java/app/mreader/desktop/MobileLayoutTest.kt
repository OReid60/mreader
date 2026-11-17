package app.mreader.desktop
import androidx.test.platform.app.InstrumentationRegistry
import android.os.Bundle
import org.json.JSONObject
import org.json.JSONTokener
import org.junit.Test
import org.junit.Assert.*

/** Read-only checks against the installed reader and its actual phone viewport. */
class MobileLayoutTest {
 @Test fun mangaPanelFitsAndKeepsProgress(){
  CoverSyncTest().withReader {js,invoke ->
   val before=invoke("snapshot",JSONObject()) as JSONObject
   val key="mobileLayoutProof"+System.nanoTime()
   js("window.$key=null;(async()=>{try{const before=await api('snapshot');const b=before.books.find(b=>b.chapters.some(c=>c.downloaded))||before.books.find(b=>b.chapters.length);if(!b)throw Error('No saved manga to inspect');state.detail=b;renderDetails();const box=document.querySelector('#detail .modal').getBoundingClientRect(),cover=document.querySelector('#detail .detail-cover').getBoundingClientRect(),source=document.querySelector('#detail .manga-source-info').getBoundingClientRect();const count=b.chapters.filter(c=>c.downloaded).length;let countPopup=count===0;if(count){document.querySelector('[data-action=manga-download-info]').click();countPopup=document.querySelector('#mobile-sheet').textContent.includes(count+' of '+b.chapters.length+' chapters');closeMobileSheet();}const proof={fits:box.top>=0&&box.bottom<=innerHeight+1,sourceBesideCover:source.left>=cover.right-1,downloadQueueHidden:!document.querySelector('#detail .download-queue'),countPopup,chapterOrders:[...document.querySelector('#chapter-order').options].map(o=>o.value).join(',')==='asc,desc',navigation:[...document.querySelectorAll('.mobile-bottom button')].map(b=>b.dataset.page).join(','),favorites:libraryCategoryNames().includes('Favorites'),width:innerWidth,height:innerHeight};closeDetail();const after=await api('snapshot');const p=s=>JSON.stringify(s.progress.map(p=>[p.bookId,p.chapterId,p.page,p.completed,p.updated]).sort());proof.progressUnchanged=p(before)===p(after);window.$key=JSON.stringify({ok:true,proof});}catch(e){window.$key=JSON.stringify({ok:false,error:String(e)});}})();")
   var value:JSONObject?=null
   for(n in 0 until 100){val decoded=JSONTokener(js("window.$key||''")).nextValue();if(decoded is String&&decoded.isNotEmpty()){value=JSONObject(decoded);break};Thread.sleep(100)}
   val result=value?:error("Phone layout check timed out");assertTrue(result.optString("error"),result.getBoolean("ok"));val proof=result.getJSONObject("proof")
   for(name in listOf("fits","sourceBesideCover","downloadQueueHidden","countPopup","chapterOrders","favorites","progressUnchanged"))assertTrue(name,proof.getBoolean(name))
   assertEquals("History,Updates,Library,Browse,Settings",proof.getString("navigation"))
   InstrumentationRegistry.getInstrumentation().sendStatus(0,Bundle().apply{putString("mobileLayoutProof",proof.toString())})
  }
 }
}
