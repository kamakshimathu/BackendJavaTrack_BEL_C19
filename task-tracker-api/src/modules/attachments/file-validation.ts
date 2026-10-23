import { AppError } from '../../shared/app-error.js';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
const allowed: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', txt: 'text/plain' };

export function validateFile(file: { originalname: string; mimetype: string; buffer: Buffer }) {
  const { originalname: name, mimetype: mime, buffer } = file;
  // A deliberately conservative single-extension ASCII name avoids path, ADS,
  // Windows device names, Unicode direction controls, and double-extension tricks.
  if (name.length > 120 || !/^[A-Za-z0-9][A-Za-z0-9 _-]*\.[A-Za-z]+$/.test(name)
    || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:[ .]|$)/i.test(name)) {
    throw new AppError(400, 'Unsafe file name');
  }
  const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  if (!allowed[extension] || allowed[extension] !== mime) throw new AppError(415, 'Unsupported file type or MIME mismatch');
  if (buffer.length === 0) throw new AppError(400, 'Empty files are not allowed');
  if (buffer.length > MAX_FILE_BYTES) throw new AppError(413, 'File exceeds 5 MiB');
  let valid = false;
  if (extension === 'pdf') {
    valid = /^%PDF-1\.[0-7]|^%PDF-2\.0/.test(buffer.subarray(0, 9).toString('ascii'))
      && /%%EOF\s*$/.test(buffer.subarray(-1024).toString('latin1'));
  } else if (extension === 'png') {
    valid = buffer.length >= 33 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      && buffer.readUInt32BE(8) === 13 && buffer.subarray(12, 16).toString('ascii') === 'IHDR'
      && buffer.subarray(-8, -4).toString('ascii') === 'IEND';
  } else if (extension === 'jpg' || extension === 'jpeg') {
    valid = buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
      && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9;
  } else {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      valid = text.trim().length > 0 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(text);
    } catch { valid = false; }
  }
  if (!valid) throw new AppError(415, 'File content does not match an allowed format');
  return { originalName: name, mimeType: allowed[extension]!, sizeBytes: buffer.length };
}
