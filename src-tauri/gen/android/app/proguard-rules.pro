# Add project specific ProGuard rules here.
# APKs are independently obfuscated. Keep app-private names out of their namespace.
-repackageclasses app.mreader.internal
-keep class app.mreader.desktop.ExtensionHost { *; }
-keep class eu.kanade.tachiyomi.** { *; }
-keep class uy.kohesive.injekt.** { *; }
-keep class rx.** { *; }
-keep class okhttp3.** { *; }
-keep class okio.** { *; }
-keep class org.jsoup.** { *; }
-keep class androidx.preference.** { *; }
-keep class kotlinx.serialization.** { *; }
-keep class kotlin.** { *; }
-keep class kotlinx.coroutines.** { *; }
-keep class app.cash.quickjs.** { *; }
-keep class org.brotli.** { *; }
-keep class io.github.zstd.** { *; }
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

-keepclassmembers class app.mreader.desktop.ReaderChrome {
    @android.webkit.JavascriptInterface <methods>;
}
