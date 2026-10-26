import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import fs from 'fs';
import path from 'path';

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
  private isConfigured: boolean = false;

  constructor() {
    this.init();
  }

  private init() {
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

      this.isConfigured = true;
      console.log(`✅ Cloudflare R2 Cloud Storage initialized: Bucket '${bucket}'`);
    } else {
      this.isConfigured = false;
      console.log('ℹ️ Cloudflare R2 credentials not detected in .env. Using local disk storage fallback (/uploads).');
    }
  }

  public isR2Enabled(): boolean {
    return this.isConfigured && this.s3Client !== null;
  }

  /**
   * Upload a file from disk path to Cloudflare R2 (or fallback to local)
   */
  public async uploadFile(
    localFilePath: string,
    filename: string,
    mimetype: string
  ): Promise<StorageUploadResult> {
    const stats = fs.statSync(localFilePath);

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

      // Clean up temp local file after successful upload to R2
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

    // Local disk fallback
    return {
      url: `/uploads/${filename}`,
      key: filename,
      size: stats.size,
      mimetype,
    };
  }

  /**
   * Generate a Presigned Direct Upload URL for client-side direct upload
   * (Allows huge videos like 200MB-500MB to upload straight from phone browser to Cloudflare R2)
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
   * Delete an object from Cloudflare R2
   */
  public async deleteFile(key: string): Promise<boolean> {
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
