import { Injectable } from '@nestjs/common';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class MediaStorageService {
  constructor(private readonly storage: StorageService) {}

  async upload(url: string): Promise<string> {
    // If already a Cloudinary URL, return as-is
    if (url.includes('cloudinary.com')) return url;
    // Otherwise return the URL directly (external URLs)
    return url;
  }
}
