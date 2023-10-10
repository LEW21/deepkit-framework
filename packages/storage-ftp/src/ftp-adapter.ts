import { FileType, FileVisibility, pathBasename, pathDirectory, Reporter, resolveStoragePath, StorageAdapter, StorageFile } from '@deepkit/storage';
import { Client, FileInfo } from 'basic-ftp';
import type { ConnectionOptions as TLSConnectionOptions } from 'tls';
import { Readable, Writable } from 'stream';

export interface StorageFtpOptions {
    /**
     * The root path where all files are stored. Optional, default is )" (standard working directory of FTP server_.
     */
    root: string;

    /**
     * Host the client should connect to. Optional, default is "localhost".
     */
    host: string;

    /**
     * Port the client should connect to. Optional, default is 21.
     */
    port?: number;

    /**
     * Timeout in secnds for all client commands. Optional, default is 30 seconds.
     */
    timeout?: number;

    user: string;

    password: string;

    /**
     * Use FTPS over TLS. Optional, default is false.
     * True is preferred explicit TLS, "implicit" supports legacy, non-standardized implicit TLS.
     */
    secure?: boolean;
    secureOptions?: TLSConnectionOptions;
}

export class StorageFtpAdapter implements StorageAdapter {
    client: Client;
    options: StorageFtpOptions = {
        root: '',
        host: 'localhost',
        user: '',
        password: '',
    };

    constructor(options: Partial<StorageFtpOptions> = {}) {
        Object.assign(this.options, options);
        this.client = new Client(this.options.timeout);
    }

    supportsVisibility() {
        return false;
    }

    async clearWorkingDir() {
        await this.ensureConnected();
        await this.client.clearWorkingDir();
    }

    protected getRemotePath(path: string): string {
        if (this.options.root === '') return path;
        return resolveStoragePath([this.options.root, path]);
    }

    async url(path: string): Promise<string> {
        return `ftp://${this.options.host}:${this.options.port}/${this.getRemotePath(path)}`;
    }

    async close(): Promise<void> {
        this.client.close();
    }

    async ensureConnected(): Promise<void> {
        if (!this.client.closed) return;
        await this.client.access({
            host: this.options.host,
            port: this.options.port,
            user: this.options.user,
            password: this.options.password,
            secure: this.options.secure,
            secureOptions: this.options.secureOptions,
        });
    }

    async makeDirectory(path: string, visibility: FileVisibility): Promise<void> {
        await this.ensureConnected();
        const remotePath = this.getRemotePath(path);
        await this.client.ensureDir(remotePath);
    }

    async files(path: string): Promise<StorageFile[]> {
        return await this.getFiles(path, false);
    }

    protected async getFiles(path: string, recursive: boolean = false): Promise<StorageFile[]> {
        await this.ensureConnected();
        const remotePath = this.getRemotePath(path);
        const entries = await this.client.list(remotePath);
        return entries.map(v => this.createStorageFile(path + '/' + v.name, v));
    }

    async delete(paths: string[]): Promise<void> {
        await this.ensureConnected();
        for (const path of paths) {
            const remotePath = this.getRemotePath(path);
            await this.client.remove(remotePath);
        }
    }

    async deleteDirectory(path: string, reporter: Reporter): Promise<void> {
        await this.ensureConnected();
        const remotePath = this.getRemotePath(path);
        await this.client.removeDir(remotePath);
    }

    async exists(paths: string[]): Promise<boolean> {
        await this.ensureConnected();
        const foldersToCheck: { folder: string, names: string[] }[] = [];

        for (const path of paths) {
            if (path === '/') continue;
            const folder = pathDirectory(path);
            const entry = foldersToCheck.find(v => v.folder === folder);
            if (entry) {
                entry.names.push(pathBasename(path));
            } else {
                foldersToCheck.push({ folder, names: [pathBasename(path)] });
            }
        }

        for (const folders of foldersToCheck) {
            const remotePath = this.getRemotePath(folders.folder);
            const files = await this.client.list(remotePath);
            for (const name of folders.names) {
                if (!files.find(v => v.name === name)) return false;
            }
        }

        return true;
    }

    async get(path: string): Promise<StorageFile | undefined> {
        if (path === '/') return;
        await this.ensureConnected();
        const remotePath = this.getRemotePath(pathDirectory(path));
        const files = await this.client.list(remotePath);
        const basename = pathBasename(path);
        const entry = files.find(v => v.name === basename);
        if (!entry) return;
        return this.createStorageFile(path, entry);
    }

    protected createStorageFile(path: string, fileInfo: FileInfo): StorageFile {
        const file = new StorageFile(path, fileInfo.isFile ? FileType.File : FileType.Directory);
        file.size = fileInfo.size;
        file.lastModified = fileInfo.modifiedAt;
        if (!file.lastModified && fileInfo.rawModifiedAt) {
            file.lastModified = parseCustomDateString(fileInfo.rawModifiedAt);
        }
        return file;
    }

    async move(source: string, destination: string, reporter: Reporter): Promise<void> {
        await this.client.rename(this.getRemotePath(source), this.getRemotePath(destination));
    }

    async read(path: string, reporter: Reporter): Promise<Uint8Array> {
        await this.ensureConnected();
        const remotePath = this.getRemotePath(path);
        const chunks: Uint8Array[] = [];
        const writeable = new Writable({
            write(chunk: any, encoding: BufferEncoding, callback: (error?: (Error | null)) => void) {
                chunks.push(chunk);
                callback(null);
            }
        });
        const stream = await this.client.downloadTo(writeable, remotePath);
        return Buffer.concat(chunks);
    }

    async write(path: string, contents: Uint8Array, visibility: FileVisibility, reporter: Reporter): Promise<void> {
        await this.ensureConnected();
        await this.client.ensureDir(this.getRemotePath(pathDirectory(path)));
        await this.client.uploadFrom(createReadable(contents), this.getRemotePath(path));
    }
}

/**
 * Best effort to parse date strings like `22 Oct 10 12:45` or `Oct 10 12:45` into a Date object.
 */
function parseCustomDateString(dateString: string): Date | undefined {
    const currentYear = new Date().getFullYear();

    const twoDigitYearMatch = dateString.match(/^\d{2}\s/);
    const fourDigitYearMatch = dateString.match(/^\d{4}\s/);

    let fullDateString;

    if (twoDigitYearMatch) {
        // Handle '22 Oct 10 12:45' format.
        const twoDigitYear = twoDigitYearMatch[0].trim();
        const baseYear = currentYear.toString().substring(0, 2); // Get the first two digits of the current year.
        fullDateString = `${baseYear}${twoDigitYear} ${dateString.substring(3)}`;
    } else if (fourDigitYearMatch) {
        // Handle '2022 Oct 10 12:45' format.
        fullDateString = dateString;
    } else {
        // Handle 'Oct 10 12:45' format.
        fullDateString = `${dateString} ${currentYear}`;
    }

    return new Date(fullDateString);
}

function createReadable(buffer: Uint8Array): Readable {
    const stream = new Readable();
    stream.push(buffer);
    stream.push(null);
    return stream;
}
