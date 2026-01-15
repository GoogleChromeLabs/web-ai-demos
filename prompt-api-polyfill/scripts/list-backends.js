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

const activeBackends = allPossibleConfigs.filter(backend => {
    const configPath = join(process.cwd(), backend.file);
    if (existsSync(configPath)) return true;
    return false;
}).map(backend => {
    const configPath = join(process.cwd(), backend.file);
    let config;
    if (existsSync(configPath)) {
        config = JSON.parse(readFileSync(configPath, 'utf8'));
    } else {
        // Fallback to .env.json (which might not be specific to this backend but could be a default)
        const defaultConfigPath = join(process.cwd(), '.env.json');
        if (existsSync(defaultConfigPath)) {
            config = JSON.parse(readFileSync(defaultConfigPath, 'utf8'));
        }
    }
    return { ...backend, config };
});

const outputPath = join(process.cwd(), 'tests', 'active-backends.json');
writeFileSync(outputPath, JSON.stringify(activeBackends, null, 2));

console.log(`Successfully listed ${activeBackends.length} active backends to ${outputPath}`);
