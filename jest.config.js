module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/test/'],
    testRegex: '(/__tests__/.*|(\\.|/)(test|spec))\\.tsx?$'
};
