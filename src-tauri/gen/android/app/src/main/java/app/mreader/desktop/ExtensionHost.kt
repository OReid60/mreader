package app.mreader.desktop

import android.content.Context
import android.content.pm.PackageManager
import dalvik.system.DexClassLoader
import eu.kanade.tachiyomi.network.NetworkHelper
import eu.kanade.tachiyomi.source.Source
import eu.kanade.tachiyomi.source.SourceFactory
import eu.kanade.tachiyomi.source.model.SManga
import eu.kanade.tachiyomi.source.model.SChapter
import eu.kanade.tachiyomi.source.model.Page
import eu.kanade.tachiyomi.source.online.HttpSource
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import org.json.JSONArray
import org.json.JSONObject
import uy.kohesive.injekt.Injekt
import uy.kohesive.injekt.api.addSingleton
import java.io.File
import java.security.MessageDigest

/** Invoked on Rust's blocking worker pool, never the Android UI thread. */
@OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
object ExtensionHost {
    private val sources = java.util.concurrent.ConcurrentHashMap<String, Source>()
    private val packages = java.util.concurrent.ConcurrentHashMap<String, List<String>>()
    // Reuse the extension's successful Browse thumbnails for saved Library titles.
    // Some extensions return art in search but omit it from manga details.
    private val coverUrls = java.util.concurrent.ConcurrentHashMap<String, String>()
    private val chapterContext = java.util.concurrent.ConcurrentHashMap<String,Map<String,SChapter>>()
    private var initialized = false
    @Synchronized private fun init(context: Context) {
        if (initialized) return
        Injekt.addSingleton<Context>(context.applicationContext)
        Injekt.addSingleton<android.app.Application>(context.applicationContext as android.app.Application)
        Injekt.addSingleton(NetworkHelper(context.applicationContext))
        Injekt.addSingleton(eu.kanade.tachiyomi.network.JavaScriptEngine(context.applicationContext))
        Injekt.addSingleton(Json { ignoreUnknownKeys = true; explicitNulls = false })
        Injekt.addSingleton<kotlinx.serialization.protobuf.ProtoBuf>(kotlinx.serialization.protobuf.ProtoBuf { encodeDefaults = true })
        initialized = true
    }
    private fun digest(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    @Suppress("DEPRECATION")
    @Synchronized private fun load(context: Context, args: JSONObject): JSONArray {
        val file=File(args.getString("path"))
        val pm=context.packageManager
        val modern=android.os.Build.VERSION.SDK_INT>=28
        val signatureFlag=if(modern)PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
        val info=pm.getPackageArchiveInfo(file.absolutePath, PackageManager.GET_META_DATA or signatureFlag)
            ?: error("Not a valid Android extension APK")
        require(info.packageName==args.getString("package")) { "APK package does not match catalog" }
        val version=if(modern)info.longVersionCode else info.versionCode.toLong()
        require(version==args.getLong("versionCode")) { "APK version does not match catalog" }
        val signatures=if(modern)info.signingInfo?.apkContentsSigners else info.signatures
        val fingerprints=signatures?.map {digest(it.toByteArray())}.orEmpty()
        require(fingerprints.size==1 && fingerprints.single()==args.getString("signingKey").lowercase()) { "APK signer does not match trusted repository" }
        val app=info.applicationInfo ?: error("Missing extension metadata")
        val meta=app.metaData ?: error("Missing extension metadata")
        val api=meta.get("tachiyomix.extensionLib")?.toString() ?: "1.4"
        require(api in listOf("1.4","1.6")) {"Unsupported extension API $api"}
        // Android 14 requires dynamically loaded bytecode to be read-only.
        require(file.setReadOnly()) {"Cannot protect extension bytecode"}
        val loader=DexClassLoader(file.absolutePath,context.codeCacheDir.absolutePath,null,context.classLoader)
        val classes=meta.getString("tachiyomi.extension.class") ?: meta.getString("tachiyomi.extension.factory") ?: error("No source class declared")
        val loaded=classes.split(';').flatMap { raw ->
            val name=raw.trim().let {if(it.startsWith('.'))info.packageName+it else it}
            when(val instance=loader.loadClass(name).getDeclaredConstructor().newInstance()) {
                is Source -> listOf(instance)
                is SourceFactory -> instance.createSources()
                else -> error("Extension class does not implement the source API")
            }
        }
        require(loaded.isNotEmpty()) {"Extension returned no sources"}
        packages.remove(info.packageName)?.forEach {sources.remove(it)}
        packages[info.packageName]=loaded.map {it.id.toString()}
        return JSONArray().apply {loaded.forEach { s ->
            sources[s.id.toString()]=s
            put(JSONObject().put("id",s.id.toString()).put("name",s.name).put("language",s.lang).put("homeUrl",(s as? HttpSource)?.baseUrl ?: ""))
        }}
    }
    private fun manga(j: JSONObject)=SManga.create().apply {url=j.getString("url");title=j.optString("title")}
    private fun mangaJson(m: SManga)=JSONObject().put("url",m.url).put("title",m.title).put("author",m.author ?: m.artist ?: "").put("description",m.description ?: "").put("cover",m.thumbnail_url ?: "").put("genre",m.genre ?: "").put("status",m.status)
    @JvmStatic
    fun request(context: Context, text: String): String = try {
        init(context)
        val args=JSONObject(text)
        val result: Any = runBlocking {
            when(args.getString("operation")) {
                "install", "load" -> load(context,args)
                "remove" -> {packages.remove(args.getString("package"))?.forEach { sources.remove(it) };JSONObject()}
                else -> {
                    val source=sources[args.getString("sourceId")] ?: error("Install this extension on this device before reading")
                    when(args.getString("operation")) {
                        "search" -> {
                            val query=args.optString("query")
                            val page=args.optInt("page",1)
                            val result=if(query.isBlank())source.getPopularManga(page) else source.getSearchManga(page,query,source.getFilterList())
                            if(coverUrls.size>512)coverUrls.clear()
                            result.mangas.forEach {m -> m.thumbnail_url?.takeIf {it.isNotBlank()}?.let {coverUrls[source.id.toString()+"\u0000"+m.url]=it}}
                            JSONObject().put("hasNextPage",result.hasNextPage).put("mangas",JSONArray().apply {result.mangas.forEach {put(mangaJson(it))}})
                        }
                        "chapters" -> {
                            val result=source.getMangaUpdate(manga(args), emptyList(),true,true)
                            if(chapterContext.size>16)chapterContext.clear()
                            chapterContext[source.id.toString()+"\u0000"+args.getString("url")]=result.chapters.associateBy{it.url}
                            JSONObject().put("manga",mangaJson(result.manga)).put("chapters",JSONArray().apply {result.chapters.forEach {c -> put(JSONObject().put("url",c.url).put("title",c.name).put("number",c.chapter_number.toString()).put("group",c.scanlator ?: "").put("memo",JSONObject(c.memo.toString())))}})
                        }
                        "pages" -> {
                            val key=source.id.toString()+"\u0000"+args.optString("mangaUrl")
                            val chapter=SChapter.create().apply {url=args.getString("url");name=args.optString("title");args.optJSONObject("memo")?.let{memo=Json.parseToJsonElement(it.toString()) as kotlinx.serialization.json.JsonObject}}
                            val prepared=if(chapter.memo.isEmpty())chapterContext[key]?.get(chapter.url)?:chapter else chapter
                            val pages=try{source.getPageList(prepared)}catch(error:IllegalStateException){
                                if(error.message?.contains("Refresh the chapter list",true)!=true||args.optString("mangaUrl").isBlank())throw error
                                // Older saved chapters lack extension memo. Recover context once
                                // for this exact source/manga/chapter; never guess another chapter.
                                val update=source.getMangaUpdate(SManga.create().apply{url=args.getString("mangaUrl");title=args.optString("mangaTitle")},emptyList(),false,true)
                                if(chapterContext.size>16)chapterContext.clear()
                                chapterContext[key]=update.chapters.associateBy{it.url}
                                source.getPageList(update.chapters.firstOrNull{it.url==chapter.url}?:throw error)
                            }
                            JSONArray().apply {pages.forEach {p ->
                                if(p.imageUrl.isNullOrEmpty())p.imageUrl=(source as? HttpSource)?.getImageUrl(p) ?: error("Source cannot resolve page images")
                                put(JSONObject().put("index",p.index).put("url",p.url).put("imageUrl",p.imageUrl))
                            }}
                        }
                        "image" -> {
                            val http=source as? HttpSource ?: error("This source does not support HTTP images")
                            val p=args.getJSONObject("page")
                            val imageUrl=if(p.has("mangaUrl")) {
                                val m=SManga.create().apply {url=p.getString("mangaUrl");title=p.optString("mangaTitle")}
                                val key=source.id.toString()+"\u0000"+m.url
                                coverUrls[key] ?: run {
                                    val details=runCatching {source.getMangaUpdate(m, emptyList(),true,false).manga.thumbnail_url?.takeIf {it.isNotBlank()}}
                                    val cover=details.getOrNull() ?: run {
                                        require(m.title.isNotBlank()) {"Source returned no cover"}
                                        source.getSearchManga(1,m.title,source.getFilterList()).mangas.firstOrNull {it.url==m.url}?.thumbnail_url?.takeIf {it.isNotBlank()}
                                    } ?: throw (details.exceptionOrNull() ?: IllegalStateException("Source returned no cover for this saved title"))
                                    coverUrls[key]=cover;cover
                                }
                            } else p.getString("imageUrl")
                            val page=Page(p.optInt("index"),p.optString("url"),imageUrl)
                            val cache=File(context.cacheDir,"extension-images").apply {mkdirs()}
                            val file=File(cache,digest((source.id.toString()+page.imageUrl).toByteArray()))
                            if(!file.exists())http.getImage(page).use {response ->
                                require(response.isSuccessful) {"Image HTTP ${response.code}"}
                                response.body.byteStream().use { input ->
                                    val temp=File(cache,file.name+".tmp")
                                    try {temp.outputStream().use {out ->
                                        val buffer=ByteArray(32768);var total=0L
                                        while(true) {val n=input.read(buffer);if(n<0)break;total+=n;require(total<=64L*1024*1024){"Image exceeds 64 MiB"};out.write(buffer,0,n)}
                                    };require(temp.renameTo(file)) {"Cannot cache image"}} finally {temp.delete()}
                                }
                            }
                            JSONObject().put("path",file.absolutePath)
                        }
                        else -> error("Unknown extension operation")
                    }
                }
            }
        }
        JSONObject().put("data",result).toString()
    } catch(e: Throwable) {
        val root=generateSequence(e){it.cause}.take(8).last()
        JSONObject().put("error", "${e.javaClass.simpleName}: ${root.javaClass.simpleName}: ${root.message ?: e.message ?: "Extension failed"}".take(2000)).toString()
    }
}
