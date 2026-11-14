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
object ExtensionHost {
    private val sources = java.util.concurrent.ConcurrentHashMap<String, Source>()
    private val packages = java.util.concurrent.ConcurrentHashMap<String, List<String>>()
    private var initialized = false
    @Synchronized private fun init(context: Context) {
        if (initialized) return
        Injekt.addSingleton<Context>(context.applicationContext)
        Injekt.addSingleton<android.app.Application>(context.applicationContext as android.app.Application)
        Injekt.addSingleton(NetworkHelper(context.applicationContext))
        Injekt.addSingleton(eu.kanade.tachiyomi.network.JavaScriptEngine(context.applicationContext))
        Injekt.addSingleton(Json { ignoreUnknownKeys = true; explicitNulls = false })
        initialized = true
    }
    private fun digest(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    @Suppress("DEPRECATION")
    @Synchronized private fun load(context: Context, args: JSONObject): JSONArray {
        val file=File(args.getString("path"))
        val pm=context.packageManager
        val info=pm.getPackageArchiveInfo(file.absolutePath, PackageManager.GET_META_DATA or PackageManager.GET_SIGNING_CERTIFICATES)
            ?: error("Not a valid Android extension APK")
        require(info.packageName==args.getString("package")) { "APK package does not match catalog" }
        require(info.longVersionCode==args.getLong("versionCode")) { "APK version does not match catalog" }
        val fingerprints=info.signingInfo?.apkContentsSigners?.map {digest(it.toByteArray())}.orEmpty()
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
                            JSONObject().put("hasNextPage",result.hasNextPage).put("mangas",JSONArray().apply {result.mangas.forEach {put(mangaJson(it))}})
                        }
                        "chapters" -> {
                            val result=source.getMangaUpdate(manga(args), emptyList(),true,true)
                            JSONObject().put("manga",mangaJson(result.manga)).put("chapters",JSONArray().apply {result.chapters.forEach {c -> put(JSONObject().put("url",c.url).put("title",c.name).put("number",c.chapter_number.toString()).put("group",c.scanlator ?: ""))}})
                        }
                        "pages" -> {
                            val chapter=SChapter.create().apply {url=args.getString("url");name=args.optString("title")}
                            JSONArray().apply {source.getPageList(chapter).forEach {p ->
                                if(p.imageUrl.isNullOrEmpty())p.imageUrl=(source as? HttpSource)?.getImageUrl(p) ?: error("Source cannot resolve page images")
                                put(JSONObject().put("index",p.index).put("url",p.url).put("imageUrl",p.imageUrl))
                            }}
                        }
                        "image" -> {
                            val http=source as? HttpSource ?: error("This source does not support HTTP images")
                            val p=args.getJSONObject("page")
                            val imageUrl=if(p.has("mangaUrl")) {
                                val m=SManga.create().apply {url=p.getString("mangaUrl");title=p.optString("mangaTitle")}
                                source.getMangaUpdate(m, emptyList(),true,false).manga.thumbnail_url ?: error("Source returned no cover")
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
        JSONObject().put("error", "${e.javaClass.simpleName}: ${e.message ?: "Extension failed"}").toString()
    }
}
