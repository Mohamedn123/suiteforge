const esbuild = require("esbuild");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').Plugin} */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',
	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

const shared = {
	bundle: true,
	format: 'cjs',
	minify: production,
	sourcemap: !production,
	sourcesContent: false,
	platform: 'node',
	logLevel: 'silent',
	plugins: [esbuildProblemMatcherPlugin],
};

async function main() {
	// Two separate bundles: the extension client and the language server.
	// They run in separate Node processes and must not share module instances.
	const clientCtx = await esbuild.context({
		...shared,
		entryPoints: ['src/extension.ts'],
		outfile: 'dist/extension.js',
		external: ['vscode'],
	});

	const serverCtx = await esbuild.context({
		...shared,
		entryPoints: ['src/lsp/server/server.ts'],
		outfile: 'dist/server.js',
	});

	if (watch) {
		await Promise.all([clientCtx.watch(), serverCtx.watch()]);
	} else {
		await Promise.all([clientCtx.rebuild(), serverCtx.rebuild()]);
		await Promise.all([clientCtx.dispose(), serverCtx.dispose()]);
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
