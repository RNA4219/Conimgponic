// Lightweight integration verification runner (non-destructive for safe CI)
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';

export function runIntegrationVerify(): number {
  try {
    const root = resolve(__dirname, '../../');
    const pkgPath = join(root, 'package.json');
    const pkgContent = readFileSync(pkgPath, { encoding: 'utf8' });
    const pkg = JSON.parse(pkgContent);
    const scripts = (pkg && typeof pkg === 'object' && pkg.scripts) ? (pkg.scripts as Record<string, string>) : {};
    const gates = ['lint', 'typecheck', 'test', 'build'];

    // Dry-run mode: only report available gates
    if (process.env.INTEGRATION_MODE === 'dry-run' || process.env.INTEGRATION_MODE === 'simulate') {
      const available = gates.filter(g => Object.prototype.hasOwnProperty.call(scripts, g));
      // eslint-disable-next-line no-console
      console.log('Integrated gates detected (dry-run):', available.join(', ') || 'none');
      return 0;
    }

    let exitCode = 0;
    for (const gate of gates) {
      if (gate in scripts) {
        try {
          execSync(scripts[gate], { stdio: 'inherit', cwd: root, shell: true });
        } catch {
          // Gate failed; stop further checks
          exitCode = 1;
          // eslint-disable-next-line no-console
          console.error(`Gate ${gate} failed`);
          break;
        }
      }
    }
    return exitCode;
  } catch {
    // eslint-disable-next-line no-console
    console.error('Integration verification failed to load configuration.');
    return 1;
  }
}
