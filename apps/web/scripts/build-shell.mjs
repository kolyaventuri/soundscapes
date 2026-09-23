import {createHash} from 'node:crypto';
import {readFile, readdir, writeFile} from 'node:fs/promises';

const directory = new URL('../dist/', import.meta.url);
const entries = await readdir(directory, {recursive: true});
const files = entries.filter(file =>
	/^(?:index\.html|manifest\.webmanifest|icon(?:-\w+)?\.(?:svg|png)|apple-touch-icon\.png|assets\/[^/]+\.(?:js|css))$/.test(file)).sort();
const template = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
const contents = await Promise.all(files.map(async file => readFile(new URL(file, directory))));
const hash = createHash('sha256').update(template);
for (const content of contents) {
	hash.update(content);
}

const version = hash.digest('hex').slice(0, 20);
const urls = files.map(file => file === 'index.html' ? '/' : `/${file}`);
await writeFile(new URL('sw.js', directory), template.replace('__SHELL_REVISION__', version).replace('[\'__SHELL_FILES__\']', JSON.stringify(urls)));
console.log(`Prepared app-shell ${version}: ${urls.length} static resources; API/audio excluded.`);
