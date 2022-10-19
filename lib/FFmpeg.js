import ffmpeg from 'fluent-ffmpeg';
import { promisify } from 'util';

const ffprobe = promisify(ffmpeg.ffprobe);

/**
 * Wrapper for FFmpeg utilities
 */
class FFmpeg {
  static async getMetadata(filePath) {
    return ffprobe(filePath);
  }
  static async createImage(type, filePath, outputPath, options) {
    if(type !== 'video' || type !== 'image') {
      throw new Error('unsupported file type');
    }
    return new Promise((resolve, reject) => {
      ffmpeg({ source: filePath }).output(outputPath)
        .size(`${options.width}x${options.height}`)
        .on('error', e => reject(e))
        .on('end', () => resolve())
        .run();
    });
  }
}

export default FFmpeg;