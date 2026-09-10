module.exports = {
    roots: ['<rootDir>/test'],
    testRegex: 'test/(.+)\\.test\\.(js?|ts?)$',
    transform: {
        '^.+\\.ts?$': 'ts-jest',
    },
    moduleFileExtensions: ['ts', 'js', 'json', 'node'],
};
