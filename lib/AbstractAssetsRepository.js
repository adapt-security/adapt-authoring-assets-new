/**
 * 
 */
class AbstractAssetsRepository {
  constructor() {
    if(!this.name) throw new Error('need repo name');
  }
  async insert(data) {
  }
  async update(data) {
  }
  async replace(data) {
  }
  async delete(data) {
  }
  async getFile(data) {
  }
}

export default AbstractAssetsRepository;