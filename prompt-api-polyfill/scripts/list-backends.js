import { readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const backendsDir = join(process.cwd(), 'backends');
const backendFiles = readdirSync(backendsDir).filter(file =>
    file.endsWith('.js') && file !== 'base.js' && file !== 'defaults.js'
);

const allPossibleConfigs = backendFiles.map(file => {
    const name = file.replace('.js', '');
    return {
        name,
        configKey: `${name.toUpperCase()}_CONFIG`,
        file: `.env-${name}.json`
    };
});

const activeBackends = allPossibleConfigs.map(backend => {
    const configPath = join(process.cwd(), backend.file);
    if (!existsSync(configPath)) {
        throw new Error(`Required configuration file "${backend.file}" for backend "${backend.name}" is missing.`);
    }
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    return { ...backend, config };
});

const outputPath = join(process.cwd(), 'tests', 'active-backends.json');
writeFileSync(outputPath, JSON.stringify(activeBackends, null, 2));

console.log(`Successfully listed ${activeBackends.length} active backends to ${outputPath}`);
