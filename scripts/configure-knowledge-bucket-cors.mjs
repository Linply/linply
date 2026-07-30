import "dotenv/config";
import { PutBucketCorsCommand, S3Client } from "@aws-sdk/client-s3";

const required = [
  "APP_BASE_URL",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_S3_BUCKET_NAME",
];
const missing = required.filter(name => !process.env[name]);
if (missing.length > 0) {
  throw new Error(
    `Missing required environment variables: ${missing.join(", ")}`
  );
}

const origin = new URL(process.env.APP_BASE_URL).origin;
const client = new S3Client({
  endpoint: process.env.AWS_ENDPOINT_URL || undefined,
  region: process.env.AWS_DEFAULT_REGION || "auto",
  forcePathStyle: process.env.AWS_S3_FORCE_PATH_STYLE === "true",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

await client.send(
  new PutBucketCorsCommand({
    Bucket: process.env.AWS_S3_BUCKET_NAME,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedOrigins: [origin],
          AllowedMethods: ["PUT"],
          AllowedHeaders: ["*"],
          MaxAgeSeconds: 3000,
        },
      ],
    },
  })
);

console.log(`Configured knowledge bucket CORS for ${origin}`);
