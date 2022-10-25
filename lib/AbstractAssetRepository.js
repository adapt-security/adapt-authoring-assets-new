/**
 * Abstract class to be used as a base for asset repositories
 */
class AbstractAssetRepository {
  /**
   * Read a file in the repository
   * @param {string} filePath Path of file to read
   * @return {external:stream~Readable}
   */
  async read(filePath) {
  }
  /**
   * Write a file to the repository
   * @param {external:stream~Readable} inputStream Input file stream 
   * @param {string} outputPath Path at which to store the file
   * @param {object} options Extra options
   * @return {Promise}
   */
  async write(inputStream, outputPath, options) {
  }
  /**
   * 
   * @param {string} oldPath Existing path of file file
   * @param {string} newPath New path for file
   * @param {object} options Extra options
   * @return {Promise}
   */
  async move(oldPath, newPath, options) {
  }
  /**
   * Removes a file from the repository
   * @param {string} filePath Path of the file to delete
   * @return {Promise}
   */
  async delete(filePath) {
  }
}

export default AbstractAssetRepository;