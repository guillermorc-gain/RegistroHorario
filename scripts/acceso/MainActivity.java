package com.guillermorc.accesoemt;

// La parte nativa de las dos aplicaciones de Control de acceso (la del
// trabajador y la de gestión). Es mucho más corta que la de horas: aquí no hay
// avisos, ni lugares de trabajo, ni chat. Solo lo que la web no puede hacer
// sola dentro de la aplicación:
//
//   · entrar con Google en una pestaña del navegador del móvil y recoger el
//     código cuando Google vuelve a la app;
//   · guardar el Excel en Descargas;
//   · descargar e instalar la versión nueva;
//   · el botón atrás, que decide la web.
//
// El montaje cambia el paquete de la primera línea por el de cada aplicación.

import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import com.getcapacitor.BridgeActivity;
import java.io.OutputStream;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        handleOAuthIntent(getIntent());
        setupJavascriptInterface();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleOAuthIntent(intent);
    }

    // Google vuelve a la página principal del servidor y esta devuelve el
    // código a la app con https://localhost/?code=…: se abre esa dirección
    // en la propia app, que es la web de dentro, y ella lo canjea.
    private void handleOAuthIntent(Intent intent) {
        if (intent == null || getBridge() == null) return;
        Uri data = intent.getData();
        if (data == null) return;
        String code = data.getQueryParameter("code");
        if (code == null || code.isEmpty()) return;
        final String url = "https://localhost/?code=" + Uri.encode(code);
        getBridge().getWebView().post(() -> getBridge().getWebView().loadUrl(url));
    }

    private void avisar(final String texto) {
        new Handler(Looper.getMainLooper()).post(() -> Toast.makeText(this, texto, Toast.LENGTH_LONG).show());
    }

    private void llamarWeb(final String js) {
        runOnUiThread(() -> {
            try { getBridge().getWebView().evaluateJavascript(js, null); } catch (Exception ignored) {}
        });
    }

    private void setupJavascriptInterface() {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        final Context ctx = this;
        getBridge().getWebView().addJavascriptInterface(new Object() {

            // En una pestaña del navegador del teléfono: así Google ve la
            // sesión que ya hay en el móvil y deja elegir la cuenta.
            @JavascriptInterface
            public void performOAuthInWebView(final String authUrl, final boolean isSilent) {
                try {
                    Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(authUrl));
                    Bundle extras = new Bundle();
                    extras.putBinder("android.support.customtabs.extra.SESSION", null);
                    i.putExtras(extras);
                    i.putExtra("android.support.customtabs.extra.TOOLBAR_COLOR", 0xFF1565C0);
                    startActivity(i);
                } catch (Exception e) {
                    avisar("No se ha podido abrir el navegador para entrar");
                    llamarWeb("app._onOAuthCode(null)");
                }
            }

            // El Excel es binario: viaja en base64 y se decodifica aquí
            @JavascriptInterface
            public void saveFileBase64(String base64, String filename) {
                try {
                    guardarEnDescargas(android.util.Base64.decode(base64, android.util.Base64.DEFAULT), filename);
                } catch (Exception e) {
                    avisar("Error al guardar");
                }
            }

            private String tipo(String nombre) {
                if (nombre.endsWith(".xlsm")) return "application/vnd.ms-excel.sheet.macroEnabled.12";
                if (nombre.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
                if (nombre.endsWith(".xls")) return "application/vnd.ms-excel";
                if (nombre.endsWith(".csv")) return "text/csv";
                return "application/octet-stream";
            }

            private void guardarEnDescargas(byte[] data, String filename) throws Exception {
                final String nombre = (filename != null && !filename.isEmpty()) ? filename : "control-acceso.xlsm";
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.Downloads.DISPLAY_NAME, nombre);
                    v.put(MediaStore.Downloads.MIME_TYPE, tipo(nombre));
                    Uri uri = ctx.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    if (uri == null) throw new Exception("sin destino");
                    try (OutputStream os = ctx.getContentResolver().openOutputStream(uri)) {
                        if (os != null) os.write(data);
                    }
                } else {
                    java.io.File f = new java.io.File(
                        Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), nombre);
                    try (java.io.FileOutputStream fos = new java.io.FileOutputStream(f)) { fos.write(data); }
                    android.media.MediaScannerConnection.scanFile(ctx, new String[]{ f.getAbsolutePath() }, null, null);
                }
                avisar("Guardado en Descargas: " + nombre);
            }

            @JavascriptInterface
            public void downloadAndInstallApk(final String url) {
                new Thread(() -> {
                    try {
                        java.net.HttpURLConnection conn = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
                        conn.setRequestProperty("User-Agent", "ControlAccesoEMT/1.0");
                        conn.setInstanceFollowRedirects(true);
                        // Sin topes, una conexión que se cae a medias deja la
                        // descarga esperando para siempre sin avisar
                        conn.setConnectTimeout(20000);
                        conn.setReadTimeout(30000);
                        conn.connect();
                        int total = conn.getContentLength();
                        java.io.File apk = new java.io.File(ctx.getCacheDir(), "update.apk");
                        try (java.io.InputStream in = conn.getInputStream();
                             java.io.FileOutputStream out = new java.io.FileOutputStream(apk)) {
                            byte[] buf = new byte[65536];
                            int leido; long bajado = 0; int ultimo = -1;
                            while ((leido = in.read(buf)) != -1) {
                                out.write(buf, 0, leido);
                                bajado += leido;
                                if (total > 0) {
                                    int pct = (int) (bajado * 100L / total);
                                    if (pct != ultimo) { ultimo = pct; llamarWeb("app._onUpdateProgress(" + pct + ")"); }
                                }
                            }
                        }
                        conn.disconnect();
                        Uri apkUri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", apk);
                        Intent instalar = new Intent(Intent.ACTION_VIEW);
                        instalar.setDataAndType(apkUri, "application/vnd.android.package-archive");
                        instalar.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        instalar.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        ctx.startActivity(instalar);
                    } catch (Exception e) {
                        avisar("Error al descargar: " + e.getMessage());
                        llamarWeb("app._onUpdateError()");
                    }
                }).start();
            }
        }, "AndroidBridge");
    }

    // Que decida la web: vuelve al listado o, si ya está en él, sale
    @Override
    public void onBackPressed() {
        android.webkit.WebView wv = (getBridge() != null) ? getBridge().getWebView() : null;
        if (wv == null) { moveTaskToBack(true); return; }
        wv.evaluateJavascript(
            "(function(){try{return app.atras()?'ok':'exit';}catch(e){return 'exit';}})()",
            result -> { if (result == null || result.contains("exit")) moveTaskToBack(true); });
    }
}
