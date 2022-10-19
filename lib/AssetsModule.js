import AbstractApiModule from 'adapt-authoring-api';
import AbstractAssetRepository from './AbstractAssetRepository.js';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import fsCallbacks from 'fs';
import fsPromises from 'fs/promises';
import LocalAssetRepository from './LocalAssetRepository.js';
import path from 'path';

ffmpeg.setFfmpegPath(ffmpegStatic);

/**
 * Asset management module
 * @extends {AbstractApiModule}
 */
class Assetsmodule extends AbstractApiModule {
  /** @override */
  async init() {
    await super.init();

    await fsPromises.mkdir(this.getConfig('thumbnailDir'), { recursive: true });

    this.repositories = {};

    const localRepo = new LocalAssetRepository();
    this.registerAssetRepository(localRepo);
    this.defaultReposotory = localRepo;

    this.router.addMiddleware(this.fileUploadMiddleware);

    const [authored, tags] = await this.app.waitForModule("authored", "tags");
    await authored.registerModule(this, { accessCheck: false });
    await tags.registerModule(this);

    this.requestHook.tap(this.onRequest.bind(this));
    this.insertHook.tap(this.handleAssetUpload.bind(this));
    this.updateHook.tap(this.handleAssetUpload.bind(this));
  }
  /** @override */
  async setValues() {
    this.root = "assets";
    this.collectionName = "assets";
    this.schemaName = "asset";

    this.useDefaultRouteConfig();

    this.routes.push({
      route: "/serve/:_id",
      handlers: { get: [this.serveAssetHandler.bind(this)] },
      permissions: { get: `read:${this.root}` }
    });
  }
  /**
   * Registers a new asset repository as an assets store
   * @param {AbstractAssetRepository} repo Instance of asset repository
   */
  registerAssetRepository(repo) {
    if(!repo instanceof AbstractAssetRepository) {
      throw new Error('not AbstractAssetRepository');
    }
    if(!repo.name) {
      throw new Error('no repo name');
    }
    if(this.repositories[repo.name]) {
      throw new Error('repo already exists');
    }
    this.log('debug', 'REGISTER_REPO', repo.name);
    this.repositories[repo.name] = repo;
  }
  resolveThumbnailPath(assetPath) {
    return path.resolve(this.getConfig('thumbnailDir'), assetPath);
  }
  /**
   * Generates a thumbnail for an uploaded asset
   * @param {object} assetData
   * @returns 
   */
  async generateThumbnail(assetData) {
    if(assetData.type !== 'image' && assetData.type !== 'video') {
      throw new Error('unsupported file type');
    }
    return new Promise(async (resolve, reject) => {
      ffmpeg(await this.doRepoAction(assetData.repo, 'read', { filePath: assetData.path }))
        .output(this.resolveThumbnailPath(assetData.path))
        .size(`${this.getConfig('thumbnailWidth')}x${this.getConfig('thumbnailHeight')}`)
        .on('error', e => reject(e))
        .on('end', () => resolve())
        .run();
    });
  }
  /**
   * Performs an action on the specified asset repository
   * @param {string} repo Name of repository
   * @param {string} action Action to perform. Should correspond to a function name on the target asset repo
   * @param {object} data Data to pass to the asset repo function
   * @returns {Promise} Resolves with the returned data
   */
  async doRepoAction(repoName, action, data) {
    const repo = this.repositories[repoName];
    if(!repo) {
      throw new Error('repo does not exist');
    }
    if(typeof repo[action] !== 'function') {
      throw new Error('repo action does not exist');
    }
    return repo[action].call(repo, data);
  }
  /**
   * Performs required asset maintenance on uploaded assets
   * @param {*} assetData Database doc of target asset
   */
  async handleAssetUpload(assetData) {
    if(!assetData.file) {
      return;
    }
    const [type, subtype] = assetData.file.mimetype.split('/');
    const repo = assetData.repo || this.defaultReposotory.name;
    const path = `${assetData._id || assetData.file.newFilename}.${subtype}`;
    const size = assetData.file.size;
    // add extra asset data
    Object.assign(assetData, { repo, type, subtype, path, size });
    // write the asset to the repo
    await this.doRepoAction(repo, 'write', { file: fsCallbacks.createReadStream(assetData.file.filepath), filePath: path });
    await this.generateThumbnail(assetData);
  }
  /**
   * 
   * @param {external:express~Request} req 
   * @returns 
   */
  async onRequest(req) {
    if(!req.apiData.modifying) {
      return;
    }
    const middleware = await this.app.waitForModule('middleware');
    const opts = {
      maxFileSize: this.getConfig('maxFileSize'),
      uploadDir: this.getConfig('assetsDir'),
      unzip: false
    };
    const fileTypes = this.getConfig('expectedFileTypes');
    await new Promise(async (resolve, reject) => middleware.fileUploadParser(fileTypes, opts)(req, null, e => e ? reject(e) : resolve()));

    Object.assign(req.apiData.data, { ...req.fileUpload.fields, file: req.fileUpload.files.file[0] });
  }
  /**
   * Serves a single asset or thumbnail
   * @param {external:express~Request} req 
   * @param {external:express~Response} res 
   * @param {function} next 
   */
  async serveAssetHandler(req, res, next) {
    const [asset] = await this.find({ _id: req.apiData.query._id });
    if(!asset) {
      throw new Error('not found');
    }
    const fileStream = req.query.thumb === "true" ? 
      fsCallbacks.createReadStream(this.resolveThumbnailPath(asset.path)) : 
      await this.doRepoAction(asset.repo, 'read', { filePath: asset.path });
    
    res.set("Content-Type", `${asset.type}/${asset.subtype}`)
    fileStream.pipe(res);
  }
  /** @override */
  async insert(data, options, mongoOptions) {
    let doc = await super.insert(data, options, mongoOptions);
    const newPath = `${doc._id}.${doc.subtype}`;
    doc = await this.update({ _id: doc._id }, { path: newPath });
    await this.doRepoAction(doc.repo, 'move', { oldPath: data.file.filepath, newPath });
    await fsPromises.rename(this.resolveThumbnailPath(data.path), this.resolveThumbnailPath(doc.path));
    return doc;
  }
  /** @override */
  async delete(query, options, mongoOptions) {
    const doc = await super.delete(query, options, mongoOptions);
    await this.doRepoAction(doc.repo, 'delete', { filePath: doc.path });
    await fsPromises.rm(this.resolveThumbnailPath(doc.path));
  }
  /** @override */
  async deleteMany() { // function not supported
    throw new Error('function not allowed');
  }
}

export default Assetsmodule;