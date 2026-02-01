import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import path from 'path';

export default defineConfig({
    plugins: [
        wasm(),
        topLevelAwait(),
        nodePolyfills({
            // Enable all Node.js polyfills to handle SDK dependencies
            protocolImports: true,
            globals: {
                Buffer: true,
                global: true,
                process: true,
            },
        }),
        // Plugin to fix libsodium-sumo.mjs import resolution
        {
            name: 'resolve-libsodium-sumo',
            resolveId(id, importer) {
                // Handle the relative import from libsodium-wrappers-sumo
                if (id === './libsodium-sumo.mjs' && importer?.includes('libsodium-wrappers-sumo')) {
                    // Resolve to the actual libsodium-sumo package location
                    const resolvedPath = path.resolve(
                        process.cwd(),
                        'node_modules/libsodium-sumo/dist/modules-sumo-esm/libsodium-sumo.mjs'
                    );
                    // Return the resolved path with file:// protocol for absolute paths
                    return resolvedPath;
                }
                return null;
            },
        },
    ],
    define: {
        'process.env': {},
        global: 'globalThis',
    },
    optimizeDeps: {
        esbuildOptions: {
            define: {
                global: 'globalThis',
            },
        },
        // Exclude packages that have issues with pre-bundling
        exclude: [
            'libsodium-sumo',
            'libsodium-wrappers-sumo',
            'undici',
            '@bokuweb/zstd-wasm',
        ],
    },
    build: {
        commonjsOptions: {
            transformMixedEsModules: true,
            ignore: ['util/types'], // Ignore specific problematic imports
        },
        target: 'esnext',
        rollupOptions: {
            external: [
                // Exclude node-only modules that aren't needed in browser
                /^node:/,
            ],
        },
    },
    resolve: {
        mainFields: ['browser', 'module', 'main'],
        conditions: ['browser', 'import', 'default'],
        alias: {
            // Alias for libsodium-sumo to help with resolution
            'libsodium-sumo': path.resolve(
                process.cwd(),
                'node_modules/libsodium-sumo/dist/modules-sumo-esm/libsodium-sumo.mjs'
            ),
            // Add polyfills for Node.js built-in modules used by undici
            'util': 'util/',
        },
    },
    // Ensure WASM files are properly served
    assetsInclude: ['**/*.wasm'],
    server: {
        fs: {
            // Allow serving files from node_modules for WASM files
            allow: ['..'],
        },
    },
});
