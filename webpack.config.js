const path = require('node:path');
const webpack = require('webpack');
const packageJson = require('./package.json');

module.exports = {
    target: 'node',
    mode: 'production',
    entry: './src/index.ts',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'index.js',
        libraryTarget: 'commonjs2',
        clean: true,
    },
    resolve: {
        extensions: ['.ts', '.js'],
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                use: 'ts-loader',
                exclude: /node_modules/,
            },
        ],
    },
    plugins: [
        new webpack.DefinePlugin({
            TOKEN_USAGE_CLI_VERSION: JSON.stringify(packageJson.version),
        }),
        new webpack.BannerPlugin({
            banner: '#!/usr/bin/env node',
            raw: true,
        }),
    ],
};
