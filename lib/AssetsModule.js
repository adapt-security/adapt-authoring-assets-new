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
      delete: filePath => localRepo.delete(filePath, localOpts),
      ensureDir: dir => localRepo.ensureDir(dir, localOpts),
      ensureExists: filePath => localRepo.ensureExists(filePath, localOpts),
      move: (oldPath, newPath) => localRepo.move(oldPath, newPath, localOpts),
      read: filePath => localRepo.read(filePath, localOpts),
      resolvePath: filePath => localRepo.resolvePath(filePath, localOpts),
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

    this.regenerateThumbnails();
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
   * Generate a thumbnail for an existing asset
   * @param {object} assetData The asset data, can pass the DB doc
   * @param {string} assetData.path Asset file location
   * @param {string} assetData.repo Asset storage repo
   * @param {string} assetData.type Asset file type
   */
  async generateThumbnail(assetData) {
    assetData.hasThumb = assetData.type === 'image' || assetData.type === 'video';
    
    if(!assetData.hasThumb) {
      return;
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
   * Reenerates any missing thumbnails
   */
  async regenerateThumbnails() {
    const assets = await this.find();
    return Promise.allSettled(assets.map(async a => {
      const _log = e => this.log('warn', `failed to generate thumbnail for ${a._id}, ${e}`, e);
      try {
        await this.localRepo.ensureExists(a.path);
      } catch(e) {
        e.code === this.app.errors.NOT_FOUND.code ? this.generateThumbnail(a).catch(_log) : _log(e);
      }
    }));
  }
  /**
   * Performs the required file operations when uploading/replacing an asset
   * @param {object} assetDoc Asset database doc
   * @param {FormidableFile} file Uploaded file data
   * @param {object} options
   * @param {boolean} options.deleteOnError Whether the asset record + files should be deleted on error
   * @returns {object} The updated asset
   */
  async updateAsset(assetDoc, file, options = { deleteOnError: false }) {
    if(!file) {
      return assetDoc;
    }
    try {
      const repo = this.getRepo(assetDoc.repo ?? this.getConfig('defaultAssetRepository'));
      const [type, subtype] = file.mimetype.split('/');
      const assetData = {
        path: `${assetDoc._id}.${subtype}`, 
        repo: repo.name, 
        size: file.size,
        subtype, 
        type
      };
      // copy asset to the correct repo
      await repo.write(await this.localRepo.read(file.filepath), assetData.path);
      await this.localRepo.delete(file.filepath);
      await this.generateThumbnail(assetData);
      
      return super.update({ _id: assetDoc._id }, assetData); // call to super to avoid recursion
    } catch(e) {
      if(options.deleteOnError) await this.delete({ _id: assetDoc._id });
      throw e;
    }
  }
  /**
   * Handles incoming file uploads
   * @param {external:express~Request} req 
   */
  async onRequest(req) {
    if(!req.apiData.modifying || req.method === 'DELETE') {
      return;
    }
    const middleware = await this.app.waitForModule('middleware');
    const opts = {
      maxFileSize: this.getConfig('maxFileUploadSize'),
      promisify: true
    };
    const fileTypes = this.getConfig('expectedFileTypes');
    await middleware.fileUploadParser(fileTypes, opts)(req);
    await middleware.urlUploadParser(fileTypes, opts)(req);
    if(req.fileUpload) {
      Object.assign(req.apiData.data, { ...req.fileUpload.fields, file: req.fileUpload.files.file[0] });
    }
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
    const doc = await super.insert(data, options, mongoOptions);
    return this.updateAsset(doc, data.file, { deleteOnError: true });
  }
  /** @override */
  async update(query, data, options, mongoOptions) {
    // make sure the path attribute isn't modified by the request
    delete data.path;
    const doc = await super.update({ _id: query._id }, data, options, mongoOptions);
    return this.updateAsset(doc, data.file);
  }
  /** @override */
  async delete(query, options, mongoOptions) {
    const doc = await super.delete(query, options, mongoOptions);
    try {
      if(doc.repo) {
        await this.getRepo(doc.repo).delete(doc.path); // asset
        await this.localRepo.delete(doc.path); // thumb
      }
    } catch(e) {
      if(e.code !== this.app.errors.NOT_FOUND.code) throw e;
    }
    return doc;
  }
  /** @override */
  async deleteMany() { // function not supported
    throw new Error('function not allowed');
  }
}

export default Assetsmodule;