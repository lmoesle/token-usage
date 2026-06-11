import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function usagePathExists(usagePath: string): boolean {
    try {
        return fs.existsSync(expandHome(usagePath));
    } catch {
        return false;
    }
}

export function expandHome(filePath: string): string {
    if (filePath === '~') {
        return os.homedir();
    }

    if (filePath.startsWith('~/')) {
        return path.join(os.homedir(), filePath.slice(2));
    }

    return filePath;
}
