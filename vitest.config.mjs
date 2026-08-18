import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default {
	test: {
		globals: true,
		environment: 'node',
		setupFiles: [path.resolve(__dirname, 'tests/mocks/obsidian.ts')],
		alias: {
			obsidian: path.resolve(__dirname, 'tests/mocks/obsidian.ts')
		}
	}
};
