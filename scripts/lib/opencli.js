/**
 * opencli wrapper — run opencli commands with graceful degradation
 * Returns parsed JSON output or null if opencli is not available
 */

import { execFile } from 'child_process';

export function runOpencli(args, timeout = 30000) {
  return new Promise((resolve) => {
    execFile('opencli', args, { timeout }, (err, stdout, stderr) => {
      if (err) {
        if (err.code === 'ENOENT') {
          process.stderr.write('[opencli] Not installed, skipping\n');
        } else {
          process.stderr.write(`[opencli] ${args.join(' ')} failed: ${err.message}\n`);
        }
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        // Try to extract JSON from output (opencli sometimes adds extra text)
        const jsonMatch = stdout.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          try { resolve(JSON.parse(jsonMatch[0])); return; } catch {}
        }
        process.stderr.write(`[opencli] ${args[0]} returned non-JSON output\n`);
        resolve(null);
      }
    });
  });
}

export async function isOpencliAvailable() {
  return new Promise((resolve) => {
    execFile('opencli', ['--version'], { timeout: 5000 }, (err) => {
      resolve(!err);
    });
  });
}
