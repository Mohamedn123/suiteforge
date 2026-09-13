import { defineConfig } from '@vscode/test-cli';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	files: 'out/test/**/*.test.js',
    workspaceFolder: fileURLToPath(new URL('./src/test/fixtures/custom-modules', import.meta.url)),
});
