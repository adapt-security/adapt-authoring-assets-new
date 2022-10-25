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
    })
  }
  /**
   * Resolves a relative path to the root directory
   * @param {string} filePath 
   * @returns {string} The resolved path
   */
  resolvePath(filePath) {
    return path.resolve(this.rootDir, filePath);
  }
  /** @override */
  async read(filePath) {
    return fsCallbacks.createReadStream(this.resolvePath(filePath));
  }
  /** @override */
    return new Promise((resolve, reject) => {
      const outputStream = fsCallbacks.createWriteStream(this.resolvePath(outputPath));
      outputStream.on('error', e => reject(e));
      inputStream.pipe(outputStream);
      inputStream.on('end', () => resolve());
    });
  }
  /** @override */
  async move(oldPath, newPath, options) {
    return fsPromises.rename(this.resolvePath(oldPath), this.resolvePath(newPath));
  }
  /** @override */
  async delete(filePath) {
    return fsPromises.rm(filePath);
  }
}

export default LocalAssetRepository;