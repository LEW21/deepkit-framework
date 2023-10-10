import { FileType, FileVisibility, pathDirectories, pathDirectory, Reporter, resolveStoragePath, StorageAdapter, StorageFile, StorageFileNotFound } from './storage.js';

export interface StorageMemoryAdapterOptions {
    url: string;
}

/**
 * In-memory storage adapter for testing purposes.
 */
export class StorageMemoryAdapter implements StorageAdapter {
    protected memory: { file: StorageFile, contents: Uint8Array }[] = [];

    protected options: StorageMemoryAdapterOptions = {
        url: '/'
    };

    constructor(options: Partial<StorageMemoryAdapterOptions> = {}) {
        Object.assign(this.options, options);
    }

    supportsVisibility() {
        return true;
    }

    async files(path: string): Promise<StorageFile[]> {
        return this.memory.filter(file => file.file.directory === path)
            .map(v => v.file);
    }

    async url(path: string): Promise<string> {
        return resolveStoragePath([this.options.url, path]);
    }

    async makeDirectory(path: string, visibility: FileVisibility): Promise<void> {
        const directories = pathDirectories(path);
        //filter out all parts that already exist
        for (const dir of directories) {
            const exists = await this.exists([dir]);
            if (exists) continue;
            const file = new StorageFile(dir);
            file.type = FileType.Directory;
            file.visibility = visibility;
            this.memory.push({ file, contents: new Uint8Array });
        }
    }

    async allFiles(path: string): Promise<StorageFile[]> {
        return this.memory.filter(file => file.file.inDirectory(path))
            .map(v => v.file);
    }

    async directories(path: string): Promise<StorageFile[]> {
        return this.memory.filter(file => file.file.directory === path)
            .filter(file => file.file.isDirectory())
            .map(v => v.file);
    }

    async allDirectories(path: string): Promise<StorageFile[]> {
        return this.memory.filter(file => file.file.inDirectory(path))
            .filter(file => file.file.isDirectory())
            .map(v => v.file);
    }

    async write(path: string, contents: Uint8Array, visibility: FileVisibility, reporter: Reporter): Promise<void> {
        let file = this.memory.find(file => file.file.path === path);
        if (!file) {
            await this.makeDirectory(pathDirectory(path), visibility);
            file = { file: new StorageFile(path), contents };
            this.memory.push(file);
        }
        file.contents = contents;
        file.file.visibility = visibility;
        file.file.size = contents.length;
        file.file.lastModified = new Date();
    }

    async read(path: string, reporter: Reporter): Promise<Uint8Array> {
        const file = this.memory.find(file => file.file.path === path);
        if (!file) throw new StorageFileNotFound('File not found');
        return file.contents;
    }

    async exists(paths: string[]): Promise<boolean> {
        const files = this.memory.filter(file => paths.includes(file.file.path));
        return files.length === paths.length;
    }

    async delete(paths: string[]): Promise<void> {
        const files = this.memory.filter(file => paths.includes(file.file.path));
        for (const file of files) {
            this.memory.splice(this.memory.indexOf(file), 1);
        }
    }

    async deleteDirectory(path: string, reporter: Reporter): Promise<void> {
        const files = this.memory.filter(file => file.file.path.startsWith(path));
        reporter.progress(0, files.length);
        let i = 0;
        for (const file of files) {
            this.memory.splice(this.memory.indexOf(file), 1);
            reporter.progress(++i, files.length);
        }
    }

    async get(path: string): Promise<StorageFile | undefined> {
        return this.memory.find(file => file.file.path === path)?.file;
    }

    async copy(source: string, destination: string, reporter: Reporter): Promise<void> {
        const files = this.memory.filter(file => file.file.path.startsWith(source));
        reporter.progress(0, files.length);
        let i = 0;
        for (const file of files) {
            const newPath = destination + file.file.path.slice(source.length);
            this.memory.push({ file: new StorageFile(newPath), contents: file.contents });
            reporter.progress(++i, files.length);
        }
    }

    async move(source: string, destination: string, reporter: Reporter): Promise<void> {
        const files = this.memory.filter(file => file.file.path.startsWith(source));
        reporter.progress(0, files.length);
        let i = 0;
        for (const file of files) {
            const newPath = destination + file.file.path.slice(source.length);
            file.file.path = newPath;
            reporter.progress(++i, files.length);
        }
    }
}
