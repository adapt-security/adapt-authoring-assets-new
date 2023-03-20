import AbstractApiModule from 'adapt-authoring-api'
import AbstractAsset from './AbstractAsset.js'
import LocalAsset from 'adapt-authoring-assets/lib/LocalAsset.js'
/**
 * Handling of assets
 * @memberof assets
 * @extends {AbstractApiModule}
 */
class Assetsmodule extends AbstractApiModule {
  /** @override */
  async init () {
    await super.init()
    /**
     * Store of all registered asset types
     */
    this.assetTypes = { [LocalAsset.name]: LocalAsset }

    const [authored, tags] = await this.app.waitForModule('authored', 'tags')
    await authored.registerModule(this, { accessCheck: false })
    await tags.registerModule(this)

    this.router.addMiddleware(this.fileUploadMiddleware)
    this.requestHook.tap(this.onRequest.bind(this))

    this.app.onReady().then(this.performHousekeeping.bind(this))
  }

  /** @override */
  async setValues () {
    this.root = 'assets'
    this.collectionName = 'assets'
    this.schemaName = 'asset'

    this.useDefaultRouteConfig()

    this.routes.push({
      route: '/serve/:_id',
      handlers: { get: [this.serveAssetHandler.bind(this)] },
      permissions: { get: [`read:${this.root}`] },
      meta: {
        get: {
          summary: 'Retrieve an asset file',
          parameters: [{ name: 'thumb', in: 'query', description: 'Whether the thumbnail should be sent', schema: { type: 'string', enum: ['true', 'false'], default: 'false' } }],
          responses: { 200: { description: 'The asset file' } }
        }
      }
    })
  }

  /**
   * Registers a new asset repository as an assets store
   * @param {AbstractAsset} assetClass The AbstractAsset class
   */
  registerAssetType (assetClass) {
    const name = assetClass.name

    if (Object.getPrototypeOf(assetClass) !== AbstractAsset) throw this.app.errors.ASSET_TYPE_INVALID.setData({ name })
    if (!name) throw this.app.errors.INVALID_PARAMS.setData({ params: ['name'] })
    if (this.assetTypes[name]) throw this.app.errors.ASSET_TYPE_EXISTS.setData({ name })

    this.log('debug', 'REGISTER_ASSET_TYPE', name)
    this.assetTypes[name] = assetClass
  }

  /**
   * Creates an asset wrapper for file system operations
   * @param {object} assetData The database data
   * @returns {AbstractAsset}
   */
  createFsWrapper (assetData, ...args) {
    const AssetType = this.assetTypes[assetData.repo ?? this.getConfig('defaultAssetRepository')]
    if (!AssetType) throw this.app.errors.ASSET_TYPE_UNKNOWN.setData({ name: assetData.repo })
    return new AssetType(assetData, ...args)
  }

  /**
   *
   * @returns {Promise}
   */
  async performHousekeeping () {
    return Promise.allSettled((await this.find()).map(assetData => {
      return new Promise(() => {
        const asset = this.createFsWrapper(assetData)
        asset.ensureExists().catch(e => this.log('error', e))
        asset.generateThumb().catch(e => this.log('warn', e))
      })
    }))
  }

  /**
   * Handles incoming file uploads
   * @param {external:ExpressRequest} req
   */
  async onRequest (req) {
    if (!req.apiData.modifying || req.method === 'DELETE') {
      return
    }
    const middleware = await this.app.waitForModule('middleware')
    const opts = {
      maxFileSize: this.getConfig('maxFileSize'),
      promisify: true
    }
    const fileTypes = this.getConfig('expectedFileTypes')
    await middleware.fileUploadParser(fileTypes, opts)(req)
    await middleware.urlUploadParser(fileTypes, opts)(req)

    Object.assign(req.apiData.data, req.body)

    if (req.fileUpload) Object.assign(req.apiData.data, { file: req.fileUpload.files.file[0] })
  }

  /**
   * Serves a single asset or thumbnail
   * @param {external:ExpressRequest} req
   * @param {external:ExpressResponse} res
   * @param {function} next
   */
  async serveAssetHandler (req, res, next) {
    try {
      const [assetData] = await this.find({ _id: req.apiData.query._id })
      if (!assetData) {
        throw this.app.errors.NOT_FOUND.setData({ type: this.schemaName, id: req.apiData.query._id })
      }
      const asset = this.createFsWrapper(assetData)
      const fileStream = await (req.query.thumb === 'true' ? asset.thumb.read() : asset.read())
      res.set('Content-Type', `${asset.data.type}/${asset.data.subtype}`)
      fileStream.pipe(res)
    } catch (e) {
      next(e)
    }
  }

  /** @override */
  async insert (data, options, mongoOptions) {
    const doc = await super.insert(data, options, mongoOptions)
    try {
      const updateData = await this.createFsWrapper(doc).updateFile(data.file, { deleteOnError: true })
      return await super.update({ _id: doc._id }, updateData, options, mongoOptions)
    } catch (e) {
      await this.delete({ _id: doc._id }, options, mongoOptions)
      throw e
    }
  }

  /** @override */
  async update (query, data, options, mongoOptions) {
    const doc = await super.update({ _id: query._id }, data, options, mongoOptions)
    if (!data.file) return doc
    const updateData = await this.createFsWrapper(doc).updateFile(data.file)
    return super.update({ _id: query._id }, updateData, options, mongoOptions)
  }

  /** @override */
  async delete (query, options, mongoOptions) {
    const doc = await super.delete(query, options, mongoOptions)
    const asset = this.createFsWrapper(doc)
    await Promise.all([asset.delete(), asset.thumb.delete()])
    return doc
  }

  /** @override */
  async deleteMany () {
    throw this.app.errors.FUNC_DISABLED.setData({ name: `${this.constructor.name}#deleteMany` })
  }
}

export default Assetsmodule
