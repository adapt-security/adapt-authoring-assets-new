import { App } from 'adapt-authoring-core';
import AbstractAssetRepository from './AbstractAssetRepository.js';
import fsCallbacks from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';

/**
 * Local asset storage
 */
class LocalAssetRepository extends AbstractAssetRepository {
  constructor() {
    super();
    this.name = 'local';
    /**
     * The root directory for all assets
     * @type {string}
     */
    this.rootDir;
    
    App.instance.waitForModule('assets').then(assets => {
      this.rootDir = assets.getConfig('assetDir');
      fsCallbacks.mkdirSync(this.rootDir, { recursive: true });
    });
  }
  /**
   * Resolves a relative path to the root directory
   * @param {string} filePath 
   * @param {LocalAssetRepositoryOptions} options 
   * @returns {string} The resolved path
   */
  resolvePath(filePath, options = { cwd: this.rootDir }) {
    if(path.isAbsolute(filePath)) return filePath;
    return path.resolve(options.cwd, filePath);
  }
  /**
   * Ensures a directory exists, creating it if not
   * @param {string} dir Directory to check
   * @param {LocalAssetRepositoryOptions} options
   */
  async ensureDir(dir, options) {
    try {
      await fsPromises.mkdir(this.resolvePath(dir, options), { recursive: true });
    } catch(e) {
      if(e.code !== 'EEXIST') throw e;
    }
  }
  /**
   * Checks if a file exists
   * @param {string} filePath Path to check
   * @param {LocalAssetRepositoryOptions} options
   */
  async ensureExists(filePath, options) {
    try {
      await fsPromises.stat(this.resolvePath(filePath, options));
    } catch(e) {
      if(e.code === 'ENOENT') throw App.instance.errors.NOT_FOUND.setData({ type: 'asset', id: filePath });
      throw e;
    }
  }
  /** @override */
  async read(filePath, options) {
    const resolvedPath = this.resolvePath(filePath, options);
    await this.ensureExists(resolvedPath);
    return fsCallbacks.createReadStream(resolvedPath);
  }
  /** @override */
  async write(inputStream, outputPath, options) {
    const resolvedPath = this.resolvePath(outputPath, options);
    await this.ensureDir(path.dirname(resolvedPath));
    return new Promise((resolve, reject) => {
      const outputStream = fsCallbacks.createWriteStream(resolvedPath);
      outputStream.on('error', e => reject(e));
      inputStream.pipe(outputStream);
      inputStream.on('end', () => resolve());
    });
  }
  /** @override */
  async move(oldPath, newPath, options) {
    const oldResolvedPath = this.resolvePath(oldPath, options);
    const newResolvedPath = this.resolvePath(newPath, options);
    await this.ensureExists(oldResolvedPath);
    await this.ensureDir(path.dirname(newResolvedPath));
    return fsPromises.rename(oldResolvedPath, newResolvedPath);
  }
  /** @override */
  async delete(filePath, options) {
    const resolvedPath = this.resolvePath(filePath, options);
    try {
      await this.ensureExists(resolvedPath);
      return fsPromises.rm(resolvedPath);
    } catch(e) { // don't need to throw an error if the file doesn't exist
      if(e.code !== App.instance.errors.NOT_FOUND.code) throw e;
    }
  }
}

export default LocalAssetRepository;