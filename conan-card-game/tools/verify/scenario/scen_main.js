// usage: electron scen_main.js <appDir> <userDataDir> <outFile> <caseFile...>
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path');
const sp = path.dirname(process.argv[1]);
app.setPath('userData', process.argv[3]);
const lib = fs.readFileSync(path.join(sp, 'scen_lib.js'), 'utf8');
const cases = process.argv.slice(5).map(f => '{\n' + fs.readFileSync(f, 'utf8') + '\n}').join('\n');
const PAGE = '(async () => {\n' + lib + '\n' + cases + '\nreturn { results, errors };\n})()';
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false });
  const logs = [];
  w.webContents.on('console-message', (e, level, message) => { if (level >= 2) logs.push('[' + level + '] ' + message.slice(0, 300)); });
  await w.loadFile(path.join(process.argv[2], 'battle.html'));
  await new Promise(r => setTimeout(r, 800));
  let out;
  try { out = await w.webContents.executeJavaScript(PAGE); } catch (e) { out = { fatal: e.message }; }
  fs.writeFileSync(process.argv[4], (out.results ? out.results.join('\n') : JSON.stringify(out)) + '\nERRORS: ' + JSON.stringify(out.errors || []) + '\nCONSOLE: ' + JSON.stringify(logs.slice(0, 20)) + '\n');
  app.quit();
});
