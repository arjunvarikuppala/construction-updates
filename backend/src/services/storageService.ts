import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';

export interface StorageUploadResult {
  url: string;
  key: string;
  size: number;
  mimetype: string;
}

export class StorageService {
  private s3Client: S3Client | null = null;
  private bucketName: string = '';
  private publicDomain: string = '';
  private isR2Configured: boolean = false;
  private isCloudinaryConfigured: boolean = false;

  constructor() {
    this.init();
  }

  private init() {
    // 1. Cloudinary Configuration
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
    const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
    const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();

    if (cloudName && apiKey && apiSecret) {
      cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
        secure: true,
      });
      this.isCloudinaryConfigured = true;
      console.log(`✅ Cloudinary Media Storage initialized: Cloud '${cloudName}'`);
    }

    // 2. Cloudflare R2 Configuration
    const accountId = process.env.R2_ACCOUNT_ID?.trim();
    const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
    const bucket = process.env.R2_BUCKET_NAME?.trim();
    const publicDomain = process.env.R2_PUBLIC_DOMAIN?.trim();

    if (accountId && accessKeyId && secretAccessKey && bucket) {
      this.bucketName = bucket;
      this.publicDomain = publicDomain ? publicDomain.replace(/\/$/, '') : '';

      this.s3Client = new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      });

      this.isR2Configured = true;
      console.log(`✅ Cloudflare R2 Cloud Storage initialized: Bucket '${bucket}'`);
    }

    if (!this.isCloudinaryConfigured && !this.isR2Configured) {
      console.log('ℹ️ No external cloud storage credentials detected in .env. Using local disk storage fallback (/uploads).');
    }
  }

  public isCloudinaryEnabled(): boolean {
    return this.isCloudinaryConfigured;
  }

  public isR2Enabled(): boolean {
    return this.isR2Configured && this.s3Client !== null;
  }

  public getActiveProvider(): 'CLOUDINARY' | 'R2' | 'LOCAL' {
    if (this.isCloudinaryConfigured) return 'CLOUDINARY';
    if (this.isR2Configured) return 'R2';
    return 'LOCAL';
  }

  /**
   * Upload a file from disk to Cloudinary or Cloudflare R2 (or fallback to local disk)
   */
  public async uploadFile(
    localFilePath: string,
    filename: string,
    mimetype: string
  ): Promise<StorageUploadResult> {
    const stats = fs.statSync(localFilePath);

    // Option A: Cloudinary Upload (Photos, Videos, PDFs)
    if (this.isCloudinaryConfigured) {
      try {
        const uploadRes = await cloudinary.uploader.upload(localFilePath, {
          folder: 'sitetrack',
          resource_type: 'auto',
          use_filename: true,
          unique_filename: true,
        });

        // Clean up temporary local file after upload
        try {
          fs.unlinkSync(localFilePath);
        } catch (e) {
          // ignore
        }

        return {
          url: uploadRes.secure_url,
          key: uploadRes.public_id,
          size: uploadRes.bytes || stats.size,
          mimetype: uploadRes.format ? `${uploadRes.resource_type}/${uploadRes.format}` : mimetype,
        };
      } catch (err: any) {
        console.error('Cloudinary upload error:', err);
        throw new Error(`Cloudinary upload failed: ${err.message || err}`);
      }
    }

    // Option B: Cloudflare R2 Upload
    if (this.isR2Enabled() && this.s3Client) {
      const fileStream = fs.createReadStream(localFilePath);
      const key = `uploads/${filename}`;

      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: fileStream,
        ContentType: mimetype,
      });

      await this.s3Client.send(command);

      try {
        fs.unlinkSync(localFilePath);
      } catch (err) {
        console.warn('Failed to clean up temp file:', err);
      }

      const url = this.publicDomain
        ? `${this.publicDomain}/${key}`
        : `https://${this.bucketName}.${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${key}`;

      return {
        url,
        key,
        size: stats.size,
        mimetype,
      };
    }

    // Option C: Local disk fallback
    return {
      url: `/uploads/${filename}`,
      key: filename,
      size: stats.size,
      mimetype,
    };
  }

  /**
   * Generate a Presigned Direct Upload URL for client-side direct upload
   */
  public async getPresignedUploadUrl(
    filename: string,
    mimetype: string,
    expiresInSeconds: number = 3600
  ): Promise<{ uploadUrl: string; finalUrl: string; key: string } | null> {
    if (!this.isR2Enabled() || !this.s3Client) {
      return null;
    }

    const key = `uploads/${Date.now()}-${filename}`;
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      ContentType: mimetype,
    });

    const uploadUrl = await getSignedUrl(this.s3Client, command, {
      expiresIn: expiresInSeconds,
    });

    const finalUrl = this.publicDomain
      ? `${this.publicDomain}/${key}`
      : `https://${this.bucketName}.${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${key}`;

    return {
      uploadUrl,
      finalUrl,
      key,
    };
  }

  /**
   * Delete an object from cloud storage
   */
  public async deleteFile(key: string, resourceType: 'image' | 'video' | 'raw' = 'image'): Promise<boolean> {
    if (this.isCloudinaryConfigured) {
      try {
        await cloudinary.uploader.destroy(key, { resource_type: resourceType });
        return true;
      } catch (err) {
        console.error('Failed to delete from Cloudinary:', err);
        return false;
      }
    }

    if (this.isR2Enabled() && this.s3Client) {
      try {
        const cleanKey = key.startsWith('/') ? key.substring(1) : key;
        await this.s3Client.send(
          new DeleteObjectCommand({
            Bucket: this.bucketName,
            Key: cleanKey,
          })
        );
        return true;
      } catch (err) {
        console.error('Failed to delete object from R2:', err);
        return false;
      }
    }
    return false;
  }
}

export const storageService = new StorageService();
