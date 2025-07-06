// utils/imageUploadUtils.js
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';

export const saveImage = async (fileBuffer, originalName, host) => {
  const extension = path.extname(originalName).toLowerCase();
  const filename = `${uuidv4()}${extension}`;
  const uploadPath = path.join('uploads', 'images', filename);
  const fullPath = path.resolve(uploadPath);

  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, fileBuffer);

  const isProduction = process.env.NODE_ENV === 'production';
  const protocol = isProduction ? 'https' : 'http';
  const imageUrl = `${protocol}://${host}/uploads/images/${filename}`;
  return {
    url: imageUrl,
    metadata: {
      filename,
      originalName,
      uploadedAt: new Date().toISOString(),
    },
  };
};