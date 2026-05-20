const path = require('node:path');
const webpack = require('webpack');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
    target: 'node',
    mode: 'production',
    entry: './src/index.ts',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'index.js',
        libraryTarget: 'commonjs2',
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
        new webpack.BannerPlugin({
            banner: '#!/usr/bin/env node',
            raw: true,
        }),
        new CopyPlugin({
            patterns: [
                { from: 'package.json', to: '' },
                { from: 'README.md', to: '' },
            ],
        }),
    ],
};
