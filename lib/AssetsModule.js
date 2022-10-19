import AbstractApiModule from 'adapt-authoring-api';
import LocalAssetsRepository from './LocalAssetsRepository';
/**
 * Asset management module
 * @extends {AbstractApiModule}
 */
class Assetsmodule extends AbstractApiModule {
  /** @override */
  async init() {
    this.repositories = [LocalAssetsRepository];

    const [middleware, server] = await this.app.waitForModule('middleware', 'server');
    this.router = server.api.createChildRouter(this.root);
    this.router.addMiddleware(middleware.fileUploadParser(this.getConfig('expectedFileTypes'), {
      maxFileSize: this.getConfig('maxFileSize'),
      uploadDir: this.getConfig('assetsDir'),
      unzip: false,
    }));

    const [authored, tags] = await this.app.waitForModule("authored", "tags");
    await authored.registerModule(this, { accessCheck: false });
    await tags.registerModule(this);

    this.requestHook.tap(this.onRequest);
    this.insertHook.tap(this.doAssetMaintenance);
    this.updateHook.tap(this.doAssetMaintenance);
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
    this.repositories.push(repo);
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
    return repo[action](data);
  }
  /**
   * Performs required asset maintenance on target asset (ensures metadata, stored in correct location etc.)
   * @param {*} assetData Database doc of target asset
   */
  async doAssetMaintenance(assetData) {
    Object.assign(assetData, {
      type: '',
      size: '',
    });
    if(assetData._id && assetData.file) { // new assets without _id can't be renamed
      return this.doRepoAction(assetData.repo, 'rename', {
        existingPath: assetData.path,
        newPath: ''
      });
    }
  }
  /**
   * 
   * @param {*} repo 
   */
  async onRequest(req) {
    if(req?.fileUpload?.files) {
      req.apiData.data.files = req.fileUpload.files.map(f => {
        console.log(f);
        return f.name;
      });
    }
  }
  /** @override */
  async insert(data, options, mongoOptions) {
    const doc = await super.insert(query, data, options, mongoOptions);
    this.doAssetMaintenance(doc);
  }
  /** @override */
  async deleteMany() { // function not supported
    throw new Error('function not allowed');
  }
}

export default Assetsmodule;