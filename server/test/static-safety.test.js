import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const SRC_DIR = path.resolve('src');

function listJsFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...listJsFiles(fullPath));
    else if (entry.name.endsWith('.js')) results.push(fullPath);
  }
  return results;
}

const serverFiles = listJsFiles(SRC_DIR);

test('all server/src JS files pass node --check syntax validation', () => {
  for (const file of serverFiles) {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  }
});

test('files importing node:fs/promises never call fs.promises.*', () => {
  for (const file of serverFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const promisesImport = content.match(/import\s+(\w+)\s+from\s+['"]node:fs\/promises['"]/);
    if (!promisesImport) continue;
    const alias = promisesImport[1];
    const invalidPattern = new RegExp(`\\b${alias}\\.promises\\.`, 'g');
    assert.equal(
      invalidPattern.test(content),
      false,
      `${path.relative(SRC_DIR, file)} imports node:fs/promises as "${alias}" so "${alias}.promises.*" is undefined`,
    );
  }
});

test('all relative imports and named exports in server/src resolve cleanly', () => {
  const exportCache = new Map();
  const getExports = (targetFile) => {
    if (exportCache.has(targetFile)) return exportCache.get(targetFile);
    const code = fs.readFileSync(targetFile, 'utf8');
    const exports = new Set();
    for (const m of code.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) {
      exports.add(m[1]);
    }
    for (const m of code.matchAll(/export\s*\{([^}]+)\}/g)) {
      for (const item of m[1].split(',')) {
        const parts = item.trim().split(/\s+as\s+/);
        const exportedName = (parts[1] || parts[0] || '').trim();
        if (exportedName) exports.add(exportedName);
      }
    }
    if (/export\s+default\b/.test(code)) exports.add('default');
    exportCache.set(targetFile, exports);
    return exports;
  };

  for (const file of serverFiles) {
    const content = fs.readFileSync(file, 'utf8');
    for (const m of content.matchAll(/import\s+(?:[^{;\n]+|\{[^}]*\})\s+from\s+['"](\.[^'"]+)['"]/g)) {
      const importClause = m[0];
      const specifier = m[1];
      let resolved = path.resolve(path.dirname(file), specifier);
      if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
        resolved = path.join(resolved, 'index.js');
      }
      assert.equal(
        fs.existsSync(resolved),
        true,
        `${path.relative(SRC_DIR, file)} imports missing module "${specifier}"`,
      );
      const namedMatch = importClause.match(/\{([^}]+)\}/);
      if (namedMatch) {
        const targetExports = getExports(resolved);
        for (const item of namedMatch[1].split(',')) {
          const importedName = item.trim().split(/\s+as\s+/)[0].trim();
          if (!importedName) continue;
          assert.equal(
            targetExports.has(importedName),
            true,
            `${path.relative(SRC_DIR, file)} imports "${importedName}" from "${specifier}", which is not exported`,
          );
        }
      }
    }
  }
});
