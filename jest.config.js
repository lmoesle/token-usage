module.exports = {
    testEnvironment: 'node',
    roots: ['<rootDir>/test/'],
    transform: {
        '^.+\\.(t|j)sx?$': '@swc/jest',
    },
    transformIgnorePatterns: ['/node_modules/(?!commander/)'],
    testRegex: '(/__tests__/.*|(\\.|/)(test|spec))\\.tsx?$'
};
