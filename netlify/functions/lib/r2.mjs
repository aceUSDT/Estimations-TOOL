/* Cloudflare R2 access (S3-compatible). Server-side only.
 * The bucket is PRIVATE: customers only ever receive short-lived authorised
 * URLs for manifest-allow-listed keys, with attachment disposition and the
 * exact safe filename. Bucket listing is never exposed.
 *
 * Customer delivery goes through the files.{ROOT_DOMAIN} download-gateway
 * Worker (signed claim, branded URL, resumable streaming) when
 * FILES_DOWNLOAD_HOST is configured. Presigned R2 URLs remain as the
 * staging fallback until the owner's domain exists — R2 presigned URLs
 * cannot use custom domains.
 */
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const DOWNLOAD_URL_TTL_SECONDS = 300;

export function r2Client(env = process.env) {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });
}

export function realR2Deps(env = process.env) {
  const client = r2Client(env);
  return {
    async getObjectText(key) {
      const out = await client.send(new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
      return out.Body.transformToString();
    },
    async presignDownload({ objectKey, fileName }) {
      const command = new GetObjectCommand({
        Bucket: env.R2_BUCKET,
        Key: objectKey,
        ResponseContentDisposition: `attachment; filename="${fileName}"`,
      });
      return getSignedUrl(client, command, { expiresIn: DOWNLOAD_URL_TTL_SECONDS });
    },
  };
}
