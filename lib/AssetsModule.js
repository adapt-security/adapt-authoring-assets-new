import AbstractApiModule from 'adapt-authoring-api';
import AbstractAssetRepository from './AbstractAssetRepository.js';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import LocalAssetRepository from './LocalAssetRepository.js';

ffmpeg.setFfmpegPath(ffmpegStatic);

/**
 * Asset management module
 * @extends {AbstractApiModule}
 */
class Assetsmodule extends AbstractApiModule {
  /**
   * Shim for local asset repository to allow calling internally
   */
  get localRepo() {
    const localRepo = this.getRepo('local');
    const localOpts = { cwd: this.getConfig('thumbnailDir') };
    return {
      delete: filePath => localRepo.write(filePath, localOpts),
      ensureDir: dir => localRepo.ensureDir(dir, localOpts),
      ensureExists: filePath => localRepo.ensureExists(filePath, localOpts),
      move: (oldPath, newPath) => localRepo.move(oldPath, newPath, localOpts),
      read: filePath => localRepo.read(filePath, localOpts),
      write: async (filePath, outputPath) => localRepo.write(await localRepo.read(filePath, localOpts), outputPath, localOpts)
    };
  }
  /** @override */
  async init() {
    await super.init();
    /**
     * Stores all registered asset repository instances
     */
    this.repositories = {};

    this.registerAssetRepository(new LocalAssetRepository());

    await this.localRepo.ensureDir(this.getConfig('thumbnailDir'));

    this.router.addMiddleware(this.fileUploadMiddleware);

    const [authored, tags] = await this.app.waitForModule("authored", "tags");
    await authored.registerModule(this, { accessCheck: false });
    await tags.registerModule(this);

    this.requestHook.tap(this.onRequest.bind(this));
    this.preInsertHook.tap(this.handleAssetUpload.bind(this));
    this.preUpdateHook.tap(this.handleAssetUpload.bind(this));
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
  /**
   * Retrieves an asset repository by name
   * @param {string} repoName Name of repository
   * @returns {AbstractAssetRepository} Asset repository
   */
  getRepo(repoName) {
    const repo = this.repositories[repoName];
    if(!repo) {
      throw new Error('repo does not exist');
    }
    return repo;
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
      ffmpeg(await this.getRepo(assetData.repo).read(assetData.path))
        .output(this.localRepo.resolvePath(assetData.path))
        .size(`${this.getConfig('thumbnailWidth')}x${this.getConfig('thumbnailHeight')}`)
        .on('error', e => reject(e))
        .on('end', () => resolve())
        .run();
    });
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
    const repo = assetData.repo || this.getRepo('defaultAssetRepository');
    const path = `${assetData._id || assetData.file.newFilename}.${subtype}`;
    const size = assetData.file.size;
    // add extra asset data
    Object.assign(assetData, { repo, type, subtype, path, size });
    // write the asset to the repo
    await this.getRepo(repo).write(this.localRepo.read(assetData.file.filepath), path);
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
    try {
      const [asset] = await this.find({ _id: req.apiData.query._id });
      if(!asset) {
        throw new Error('not found');
      }
      const repo = req.query.thumb === "true" ? this.localRepo : this.getRepo(asset.repo);
      const fileStream = await repo.read(asset.path);
      res.set("Content-Type", `${asset.type}/${asset.subtype}`)
      fileStream.pipe(res);
    } catch(e) {
      next(e);
    }
  }
  /** @override */
  async insert(data, options, mongoOptions) {
    let doc = await super.insert(data, options, mongoOptions);
    const newPath = `${doc._id}.${doc.subtype}`;
    doc = await this.update({ _id: doc._id }, { path: newPath });
    await this.getRepo(doc.repo).move(data.file.filepath, newPath);
    await this.localRepo.move(data.path, doc.path);
    return doc;
  }
  /** @override */
  async delete(query, options, mongoOptions) {
    const doc = await super.delete(query, options, mongoOptions);
    await this.getRepo(doc.repo).delete(doc.path);
    await this.localRepo.delete(doc.path);
  }
  /** @override */
  async deleteMany() { // function not supported
    throw new Error('function not allowed');
  }
}

export default Assetsmodule;