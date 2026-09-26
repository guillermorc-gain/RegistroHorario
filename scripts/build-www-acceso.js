// Copia la web de Control de acceso a www-acceso/ para meterla en los dos APK
// (el del trabajador y el de gestión: es la misma web, cambia el rol).
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src  = path.join(root, 'control-acceso');
const www  = path.join(root, 'www-acceso');

fs.rmSync(www, { recursive: true, force: true });
fs.mkdirSync(www, { recursive: true });

['index.html', 'app.js', 'version.js', 'plantilla.xlsm'].forEach(f => {
    fs.copyFileSync(path.join(src, f), path.join(www, f));
});
for (const dir of ['icons', 'vendor']) {
    fs.cpSync(path.join(src, dir), path.join(www, dir), { recursive: true });
}

console.log('✅ www-acceso/ built');
