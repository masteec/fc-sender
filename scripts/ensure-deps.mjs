import fs from 'fs';
import path from 'path';

// Fix universalify nested copy in electron-updater / build tools if index.js was pruned
const rootUniversalify = path.resolve('node_modules', 'universalify', 'index.js');
if (fs.existsSync(rootUniversalify)) {
  const content = fs.readFileSync(rootUniversalify);
  const targets = [
    path.resolve('node_modules', 'electron-updater', 'node_modules', 'universalify', 'index.js'),
    path.resolve('node_modules', '@electron', 'windows-sign', 'node_modules', 'universalify', 'index.js'),
    path.resolve('node_modules', '@malept', 'flatpak-bundler', 'node_modules', 'universalify', 'index.js'),
    path.resolve('node_modules', 'dmg-builder', 'node_modules', 'universalify', 'index.js')
  ];

  for (const t of targets) {
    const dir = path.dirname(t);
    if (fs.existsSync(dir) && !fs.existsSync(t)) {
      fs.writeFileSync(t, content);
      console.log('[prebuild] Restored missing index.js in:', t);
    }
  }
}
