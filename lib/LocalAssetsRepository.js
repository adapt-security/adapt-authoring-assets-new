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
  async read(data) {
    return fsCallbacks.createReadStream(this.resolvePath(data.filePath));
  }
  /** @override */
  async write(data) {
    return new Promise((resolve, reject) => {
      const ws = fsCallbacks.createWriteStream(this.resolvePath(data.filePath));
      ws.on('error', e => reject(e));
      data.file.pipe(ws);
      data.file.on('end', () => resolve());
    });
  }
  /** @override */
  async move(data) {
    return fsPromises.rename(this.resolvePath(data.oldPath), this.resolvePath(data.newPath));
  }
  /** @override */
  async delete(data) {
    return fsPromises.rm(data.filePath);
  }
}

export default LocalAssetRepository;