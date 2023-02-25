import { App } from 'adapt-authoring-core';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import path from 'path';

ffmpeg.setFfprobePath(ffprobeStatic.path);
ffmpeg.setFfmpegPath(ffmpegStatic);
/**
 * Base class for handling an asset
 * @memberof assets
 */
class AbstractAsset {
  /**
   * Name of the asset type
   * @type {string}
   */
  static get name() {
    return 'local';
  }
  constructor(data) {
    this.assets = App.instance.dependencyloader.instances['adapt-authoring-assets'];
    this.root = this.assetRoot;
    this.setData(data);
  }
  /**
   * Reference to the ffmpeg module
   * @type {*}
   */
  get ffmpeg() {
    return ffmpeg;
  }
  /**
   * Reference to the ffprobe module
   * @type {*}
   */
  get ffprobe() {
    return ffmpeg.ffprobe;
  }
  /**
   * The root location for this asset type
   * @type {string}
   */
  get assetRoot() {
    throw App.instance.errors.FUNC_NOT_OVERRIDDEN.setData({ name: `${this.constructor.name}#assetRoot` });
  }
  /**
   * The asset path
   * @type {string}
   */
  get path() {
    return this.data.path ? this.resolvePath(this.data.path) : undefined;
  }
  /**
   * Whether the asset has a thumbnail
   */
  get hasThumb() {
    return this.data.hasThumb;
  }
  /**
   * Whether the asset is an audio file
   */
  get isAudio() {
    return this.data.type === 'audio';
  }
  /**
   * Whether the asset is an image file
   */
  get isImage() {
    return this.data.type === 'image';
  }
  /**
   * Whether the asset is an video file
   */
  get isVideo() {
    return this.data.type === 'video';
  }
  /**
   * Access to the thumbnail asset
   * @return {LocalAsset} The thumb asset
   */
   get thumb() {
    if(!this._thumb) {
      const id = this.data?._id?.toString() ?? this.path.replace(path.extname(this.path), '');
      this._thumb = this.assets.createFsWrapper({ 
        repo: 'local', path: id + this.assets.getConfig('thumbnailExt'), 
        root: this.assets.getConfig('thumbnailDir') 
      });
    }
    return this._thumb;
  }
  setData(data) {
    if(data.root) {
      this.root = data.root;
      delete data.root;
    }
    if(!this.data) this.data = {};
    Object.assign(this.data, JSON.parse(JSON.stringify(data)));
    return this.data;
  }
  /**
   * Returns the expected file type from a MIME subtype
   * @param {FormidableFile} file File data
   * @returns {String}
   */
  getFileExtension(file) {
    const subtype = file.mimetype.split('/')[1];
    const originalExtension = path.extname(file.originalFilename);
    switch(subtype) {
      case 'svg+xml': 
        return originalExtension.startsWith('.svg') ? originalExtension : 'svg';
      default: 
        return subtype;
    }
  }
  /**
   * Generate a thumbnail for an existing asset
   * @param {object} options Optional settings
   * @param {string} options.regenerate Will regenerate the thumbnail if one already exists
   */
  async generateThumb(options = { regenerate: false }) {
    if(!this.hasThumb) {
      return;
    }
    await this.thumb.ensureDir(this.assets.getConfig('thumbnailDir'));
    try {
      await this.thumb.ensureExists();
      if(!options.regenerate) return;
    } catch(e) {
      // thumb doesn't exist, continue
    }
    /**
     * ffmpeg doesn't work with streams in all cases, so we need to 
     * temporarily download the asset locally before processing
     */
    const tempAsset = new (await import('./LocalAsset.js')).default({ path: path.join(this.thumb.dirname, this.filename) });
    await tempAsset.write(await this.read(), tempAsset.path);
    const ff = this.ffmpeg(tempAsset.path);
    const size = `${this.assets.getConfig('thumbnailWidth')}x?`;
    try {
      await new Promise(async (resolve, reject) => {
        ff.on('end', () => resolve());
        ff.on('error', error => reject(App.instance.errors.GENERATE_THUMB_FAIL.setData({ file: this.path, error })));
  
        if(this.isImage) ff.size(size).save(this.thumb.path);
        if(this.isVideo) ff.screenshots({ size, timemarks: ['25%'], folder: this.thumb.dirname, filename: this.thumb.filename });
      });
    } catch(e) {
      throw e;
    } finally { // remove temp asset
      await tempAsset.delete();
    }
  }
  /**
   * Performs the required file operations when uploading/replacing an asset
   * @param {FormidableFile} file Uploaded file data
   * @returns {object} The update data
   */
  async updateFile(file) {
    const [type, subtype] = file.mimetype.split('/');
    // remove old file and set new path
    await this.delete();
    this.setData({ 
      path: `${this.data._id}.${this.getFileExtension(file)}`, 
      repo: this.data.repo, 
      size: file.size,
      subtype, 
      type,
      hasThumb: (type === 'image' && subtype !== 'svg+xml') || type === 'video'
    });
    // perform filesystem operations
    const localAsset = this.assets.createFsWrapper({ repo: 'local', path: file.filepath });
    await this.write(await localAsset.read(), this.path);
    await localAsset.delete();
    await this.generateThumb({ regenerate: true });
    // generate metadata
    return this.setData(await this.generateMetadata(localAsset));
  }
  /**
   * Resolves a relative path to the root directory. Must be overridden by subclasses.
   * @param {string} filePath 
   * @returns {string} The resolved path
   */
  resolvePath(filePath) {
  }
  /**
   * Ensures a directory exists, creating it if not. Must be overridden by subclasses.
   * @param {string} dir Directory to check
   * @return {Promise}
   */
  async ensureDir(dir) {
  }
  /**
   * Checks if a file exists. Must be overridden by subclasses.
   * @return {Promise} Rejects if not found
   */
  async ensureExists() {
  }
  /**
   * Sets metadata on an existing asset
   * @typedef
   * @return {AssetMetadata} The metadata
   */
  async generateMetadata() {
  }
  /**
   * Read a file. Must be overridden by subclasses.
   * @return {external:stream~Readable}
   */
  async read() {
  }
  /**
   * Write a file to the repository. Must be overridden by subclasses.
   * @param {external:stream~Readable} inputStream The file read stream
   * @param {string} outputPath Path at which to store the file
   * @return {Promise}
   */
  async write(inputStream, outputPath) {
  }
  /**
   * 
   * @param {string} newPath New path for file
   * @return {Promise}
   */
  async move(newPath) {
  }
  /**
   * Removes a file from the repository
   * @return {Promise}
   */
  async delete() {
    if(this.hasThumb) await this.thumb.delete();
  }
}

export default AbstractAsset;