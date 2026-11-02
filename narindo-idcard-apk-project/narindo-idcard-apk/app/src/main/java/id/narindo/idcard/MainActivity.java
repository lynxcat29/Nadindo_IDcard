package id.narindo.idcard;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Parcelable;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.core.content.FileProvider;
import androidx.webkit.WebViewAssetLoader;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Narindo ID Card Generator — pembungkus WebView.
 * Aplikasi web dimuat dari assets/www/index.html melalui https://appassets.androidplatform.net
 * (origin https asli, sehingga localStorage, fetch ke Google Apps Script & CORS berjalan normal).
 */
public class MainActivity extends Activity {

    private static final String HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + HOST + "/assets/www/index.html";
    private static final int REQ_FILE = 1001;
    private static final int REQ_STORAGE = 1002;
    private static final String SAVE_DIR = "Narindo ID Card";

    private WebView web;
    private WebView printView;
    private ValueCallback<Uri[]> fileCallback;
    private Uri cameraUri;
    private File cameraFile;
    private final Map<String, PendingFile> pending = new HashMap<>();

    private static class PendingFile {
        File file;
        String name;
        String mime;
        OutputStream out;
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setBuiltInZoomControls(false);
        s.setSupportZoom(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .setDomain(HOST)
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (HOST.equals(u.getHost())) return false;
                // Link Google Drive / Spreadsheet dibuka di aplikasi Drive / Sheets / browser
                openExternal(u);
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                return openChooser(params);
            }
        });

        web.addJavascriptInterface(new Bridge(), "AndroidBridge");

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(START_URL);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    private void openExternal(Uri u) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u));
        } catch (ActivityNotFoundException e) {
            toast("Tidak ada aplikasi untuk membuka link ini");
        }
    }

    private void toast(final String msg) {
        runOnUiThread(() -> Toast.makeText(MainActivity.this, msg, Toast.LENGTH_LONG).show());
    }

    // ------------------------------------------------------------------ pilih file / kamera
    private boolean openChooser(WebChromeClient.FileChooserParams params) {
        String[] accept = params.getAcceptTypes();
        boolean multiple = params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE;
        boolean imagesOnly = accept != null && accept.length > 0;
        if (accept != null) {
            for (String a : accept) {
                for (String part : a.split(",")) {
                    String p = part.trim().toLowerCase();
                    if (p.isEmpty()) continue;
                    boolean isImg = p.startsWith("image/") || p.equals(".jpg") || p.equals(".jpeg") || p.equals(".png") || p.equals(".webp");
                    if (!isImg) imagesOnly = false;
                }
            }
        }

        Intent content = new Intent(Intent.ACTION_GET_CONTENT);
        content.addCategory(Intent.CATEGORY_OPENABLE);
        if (imagesOnly) {
            content.setType("image/*");
            content.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/jpeg", "image/png", "image/webp"});
        } else {
            content.setType("*/*");
        }
        if (multiple) content.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);

        Intent chooser = Intent.createChooser(content, imagesOnly ? "Pilih foto karyawan" : "Pilih file");

        cameraUri = null;
        cameraFile = null;
        if (imagesOnly && !multiple) {
            try {
                File dir = new File(getCacheDir(), "camera");
                if (!dir.exists()) dir.mkdirs();
                cameraFile = new File(dir, "foto_" + System.currentTimeMillis() + ".jpg");
                cameraUri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", cameraFile);
                Intent cam = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                cam.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
                cam.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                cam.setClipData(ClipData.newRawUri("", cameraUri));
                if (cam.resolveActivity(getPackageManager()) != null) {
                    chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Parcelable[]{cam});
                }
            } catch (Exception e) {
                cameraUri = null;
            }
        }

        try {
            startActivityForResult(chooser, REQ_FILE);
            return true;
        } catch (ActivityNotFoundException e) {
            fileCallback = null;
            toast("Tidak ada aplikasi pemilih file");
            return false;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_FILE || fileCallback == null) return;
        Uri[] result = null;
        if (resultCode == RESULT_OK) {
            List<Uri> uris = new ArrayList<>();
            if (data != null && data.getClipData() != null) {
                ClipData cd = data.getClipData();
                for (int i = 0; i < cd.getItemCount(); i++) {
                    Uri u = cd.getItemAt(i).getUri();
                    if (u != null && !u.equals(cameraUri)) uris.add(u);
                }
            }
            if (uris.isEmpty() && data != null && data.getData() != null) uris.add(data.getData());
            if (uris.isEmpty() && cameraFile != null && cameraFile.exists() && cameraFile.length() > 0) uris.add(cameraUri);
            if (!uris.isEmpty()) result = uris.toArray(new Uri[0]);
        }
        fileCallback.onReceiveValue(result);
        fileCallback = null;
    }

    // ------------------------------------------------------------------ simpan / bagikan file
    private String copyToDownloads(File src, String name, String mime) throws IOException {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentResolver cr = getContentResolver();
            ContentValues v = new ContentValues();
            v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
            v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/" + SAVE_DIR);
            Uri uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
            if (uri == null) throw new IOException("Tidak dapat membuat file di Download");
            try (InputStream in = new FileInputStream(src); OutputStream out = cr.openOutputStream(uri)) {
                if (out == null) throw new IOException("Tidak dapat menulis file");
                copy(in, out);
            }
        } else {
            if (checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                runOnUiThread(() -> requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_STORAGE));
                throw new IOException("Izinkan akses penyimpanan, lalu tekan tombol download lagi.");
            }
            File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), SAVE_DIR);
            if (!dir.exists() && !dir.mkdirs()) throw new IOException("Folder Download tidak dapat dibuat");
            File dst = new File(dir, name);
            int n = 1;
            String base = name.contains(".") ? name.substring(0, name.lastIndexOf('.')) : name;
            String ext = name.contains(".") ? name.substring(name.lastIndexOf('.')) : "";
            while (dst.exists()) dst = new File(dir, base + " (" + (n++) + ")" + ext);
            try (InputStream in = new FileInputStream(src); OutputStream out = new FileOutputStream(dst)) {
                copy(in, out);
            }
            android.media.MediaScannerConnection.scanFile(this, new String[]{dst.getAbsolutePath()}, new String[]{mime}, null);
        }
        return "Download/" + SAVE_DIR + "/" + name;
    }

    private static void copy(InputStream in, OutputStream out) throws IOException {
        byte[] buf = new byte[64 * 1024];
        int r;
        while ((r = in.read(buf)) != -1) out.write(buf, 0, r);
    }

    private void shareFile(File f, String mime) {
        Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", f);
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType(mime);
        send.putExtra(Intent.EXTRA_STREAM, uri);
        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        Intent ch = Intent.createChooser(send, "Bagikan ID Card");
        ch.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        runOnUiThread(() -> startActivity(ch));
    }

    // ------------------------------------------------------------------ print
    private void printHtmlInternal(String html, String jobName) {
        final WebView pv = new WebView(this);
        pv.getSettings().setJavaScriptEnabled(false);
        pv.setWebViewClient(new WebViewClient() {
            private boolean done = false;

            @Override
            public void onPageFinished(WebView view, String url) {
                if (done) return;
                done = true;
                PrintManager pm = (PrintManager) getSystemService(PRINT_SERVICE);
                PrintDocumentAdapter adapter = view.createPrintDocumentAdapter(jobName);
                pm.print(jobName, adapter, new PrintAttributes.Builder()
                        .setColorMode(PrintAttributes.COLOR_MODE_COLOR)
                        .build());
            }
        });
        printView = pv; // simpan referensi agar tidak dibersihkan GC sebelum selesai
        pv.loadDataWithBaseURL("https://" + HOST + "/", html, "text/html", "UTF-8", null);
    }

    // ------------------------------------------------------------------ jembatan JavaScript
    private class Bridge {
        @JavascriptInterface
        public String saveStart(String name, String mime) {
            try {
                File dir = new File(getCacheDir(), "share");
                if (!dir.exists()) dir.mkdirs();
                String id = UUID.randomUUID().toString();
                PendingFile p = new PendingFile();
                p.name = name.replaceAll("[\\\\/:*?\"<>|]", "_");
                p.mime = mime == null || mime.isEmpty() ? "application/octet-stream" : mime;
                p.file = new File(dir, p.name);
                p.out = new FileOutputStream(p.file);
                synchronized (pending) {
                    pending.put(id, p);
                }
                return id;
            } catch (IOException e) {
                return "";
            }
        }

        @JavascriptInterface
        public void saveChunk(String id, String base64) {
            PendingFile p;
            synchronized (pending) {
                p = pending.get(id);
            }
            if (p == null) return;
            try {
                p.out.write(Base64.decode(base64, Base64.DEFAULT));
            } catch (IOException ignored) {
            }
        }

        @JavascriptInterface
        public String saveEnd(String id, boolean share) {
            PendingFile p;
            synchronized (pending) {
                p = pending.remove(id);
            }
            if (p == null) return "Gagal menyimpan file.";
            try {
                p.out.close();
                if (share) {
                    shareFile(p.file, p.mime);
                    return "Pilih aplikasi untuk membagikan " + p.name;
                }
                String where = copyToDownloads(p.file, p.name, p.mime);
                toast("Tersimpan: " + where);
                return "Tersimpan di " + where;
            } catch (IOException e) {
                return "Gagal: " + e.getMessage();
            }
        }

        @JavascriptInterface
        public void printHtml(final String html, final String jobName) {
            runOnUiThread(() -> printHtmlInternal(html, jobName == null ? "ID Card" : jobName));
        }

        @JavascriptInterface
        public String getDeviceName() {
            return Build.MANUFACTURER + " " + Build.MODEL;
        }

        @JavascriptInterface
        public String appVersion() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "";
            }
        }
    }
}
