/**
 * Just enough of the File System Access API, in memory. `caseInsensitive` resolves names the way macOS and
 * Windows disks do: "Notes.md" finds "notes.md". `failWrites` names files whose writes fail.
 */
let clock = 1;

export class FakeFile {
  readonly kind = 'file';
  bytes = new Uint8Array();
  lastModified = clock++;
  readonly name: string;
  private readonly fs: { failWrites: Set<string> };
  constructor(name: string, fs: { failWrites: Set<string> }) {
    this.name = name;
    this.fs = fs;
  }
  isSameEntry(other: unknown): Promise<boolean> {
    return Promise.resolve(other === this);
  }
  getFile() {
    const bytes = this.bytes;
    return Promise.resolve({
      size: bytes.length,
      lastModified: this.lastModified,
      arrayBuffer: () => Promise.resolve(bytes.slice().buffer),
    });
  }
  createWritable() {
    let next = this.bytes;
    return Promise.resolve({
      write: (b: Uint8Array) => {
        if (this.fs.failWrites.has(this.name)) return Promise.reject(new Error('disk full'));
        next = b.slice();
        return Promise.resolve();
      },
      close: () => {
        this.bytes = next;
        this.lastModified = clock++;
        return Promise.resolve();
      },
    });
  }
}

export class FakeDir {
  readonly kind = 'directory';
  private readonly children = new Map<string, FakeFile | FakeDir>();
  readonly name: string;
  private readonly fs: { caseInsensitive: boolean; failWrites: Set<string> };
  constructor(name: string, fs: { caseInsensitive: boolean; failWrites: Set<string> }) {
    this.name = name;
    this.fs = fs;
  }
  private key(name: string) {
    return this.fs.caseInsensitive ? name.toLowerCase() : name;
  }
  isSameEntry(other: unknown): Promise<boolean> {
    return Promise.resolve(other === this);
  }
  getDirectoryHandle(name: string, opts: { create?: boolean } = {}): Promise<FakeDir> {
    const found = this.children.get(this.key(name));
    if (found instanceof FakeDir) return Promise.resolve(found);
    if (found) return Promise.reject(new DOMException('file', 'TypeMismatchError'));
    if (!opts.create) return Promise.reject(new DOMException('missing', 'NotFoundError'));
    const d = new FakeDir(name, this.fs);
    this.children.set(this.key(name), d);
    return Promise.resolve(d);
  }
  getFileHandle(name: string, opts: { create?: boolean } = {}): Promise<FakeFile> {
    const found = this.children.get(this.key(name));
    if (found instanceof FakeFile) return Promise.resolve(found);
    if (found) return Promise.reject(new DOMException('dir', 'TypeMismatchError'));
    if (!opts.create) return Promise.reject(new DOMException('missing', 'NotFoundError'));
    const f = new FakeFile(name, this.fs);
    this.children.set(this.key(name), f);
    return Promise.resolve(f);
  }
  removeEntry(name: string): Promise<void> {
    if (!this.children.delete(this.key(name)))
      return Promise.reject(new DOMException('missing', 'NotFoundError'));
    return Promise.resolve();
  }
  async *entries(): AsyncGenerator<[string, FakeFile | FakeDir]> {
    for (const c of [...this.children.values()]) yield [c.name, c];
  }
  async *keys(): AsyncGenerator<string> {
    for (const c of [...this.children.values()]) yield c.name;
  }
}

/** An empty fake folder, and the switches that make it misbehave. */
export function fakeFolder(name: string, caseInsensitive = false) {
  const fs = { caseInsensitive, failWrites: new Set<string>() };
  return { root: new FakeDir(name, fs), fs };
}
