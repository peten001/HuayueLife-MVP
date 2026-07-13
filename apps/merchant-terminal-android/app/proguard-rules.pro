# No JavaScript interface is exposed in stage 1. Keep only WebView callback methods
# that are referenced by the Android framework.
-keepclassmembers class * extends android.webkit.WebChromeClient {
    public *;
}
-keepclassmembers class * extends android.webkit.WebViewClient {
    public *;
}
