import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function discoverBackends(
  backendsDir = path.resolve(__dirname, '../backends')
) {
  return fs
    .readdirSync(backendsDir)
    .filter(
      (file) =>
        file.endsWith('.js') && file !== 'base.js' && file !== 'defaults.js'
    )
    .map((file) => {
      const name = file.replace('.js', '');
      return {
        name,
        nameCaps: name.toUpperCase(),
        configKey: `${name.toUpperCase()}_CONFIG`,
        envFile: `.env-${name}.json`,
        path: `./backends/${file}`,
        fullPath: path.resolve(backendsDir, file),
      };
    });
}

/**
 * Filter for backends that have a local .env-[name].json file.
 */
export function getActiveBackends(backends = discoverBackends()) {
  return backends
    .map((backend) => {
      const configPath = path.resolve(__dirname, '../', backend.envFile);
      if (!fs.existsSync(configPath)) {
        return null;
      }
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return { ...backend, config };
    })
    .filter(Boolean);
}

// When run directly, generate tests/active-backends.json
if (import.meta.url === `file://${process.argv[1]}`) {
  const activeBackends = getActiveBackends();
  const outputPath = path.resolve(__dirname, '../tests/active-backends.json');

  if (!fs.existsSync(path.dirname(outputPath))) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  }

  fs.writeFileSync(outputPath, JSON.stringify(activeBackends, null, 2));
  console.log(
    `Successfully listed ${activeBackends.length} active backends to ${outputPath}`
  );
}
