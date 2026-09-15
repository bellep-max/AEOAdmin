import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const bucket = process.env.EXECUTION_ARTIFACT_BUCKET;
const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-east-1" });
const root = path.resolve(
  process.env.EXECUTION_ARTIFACT_DIR ?? "data/execution-artifacts",
);
function local(key: string) {
  if (process.env.NODE_ENV === "production")
    throw new Error("EXECUTION_ARTIFACT_BUCKET required in production");
  const target = path.resolve(root, key);
  if (!target.startsWith(root + path.sep))
    throw new Error("invalid storage key");
  return target;
}
export async function putExecutionArtifact(
  key: string,
  bytes: Buffer,
  contentType: string,
) {
  if (bucket) {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
      }),
    );
    return;
  }
  const file = local(key);
  await mkdir(path.dirname(file), { recursive: true });
  const temp = file + ".tmp-" + randomUUID();
  await writeFile(temp, bytes);
  await rename(temp, file);
}
export async function getExecutionArtifact(key: string): Promise<Buffer> {
  if (bucket) {
    const response = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    return Buffer.from(await response.Body!.transformToByteArray());
  }
  return readFile(local(key));
}
