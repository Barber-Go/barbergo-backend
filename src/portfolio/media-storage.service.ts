import { Injectable } from '@nestjs/common';

@Injectable()
export class MediaStorageService {
  /** Stub — returns the URL as-is. Replace with S3/Cloudinary integration later. */
  async upload(url: string): Promise<string> {
    return url;
  }
}
