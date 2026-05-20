import { getGreetingMessage } from '../src/index';

describe('token-usage', () => {
    test('prints the hello-world greeting', () => {
        expect(getGreetingMessage()).toBe('Hello, token-usage!');
    });
});
