// Lambda entry point: the 15-minute job. EventBridge Scheduler invokes it
// with no payload (terraform/lambda.tf).
//
// Reads the API, builds the summary and overwrites one object:
//   s3://mco-mesonet/compliance/v1/summary.json
//   = https://data2.climate.umt.edu/mesonet/compliance/v1/summary.json
//
// Any failure throws before the PutObject, so the invocation counts as an
// Error, the previous summary stays published, and its generated_at shows its
// age. The missed-run alarm watches for an hour with no successful run.
//
// @aws-sdk/client-s3 is the copy bundled in the Lambda Node.js base image,
// whose digest the Dockerfile pins. The repo has no npm dependencies.

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DEFAULT_API, describe, fetchInputs, render } from '../src/job.js';

const BUCKET = process.env.S3_BUCKET;
const KEY = process.env.S3_KEY || 'compliance/v1/summary.json';
const API = process.env.API_BASE || DEFAULT_API;

const s3 = new S3Client({});

export async function handler() {
  if (!BUCKET) throw new Error('S3_BUCKET is not set');
  const { summary, body, bytes } = render(await fetchInputs(API));
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: KEY,
    Body: body,
    ContentType: 'application/json; charset=utf-8',
    // No CloudFront invalidation: the data2 cache policy honours this
    // (min_ttl 0), as it does for mesonet-cameras' schedule and manifests.
    CacheControl: 'public, max-age=60',
  }));
  console.log(`s3://${BUCKET}/${KEY}: ${describe(summary, bytes)}`);
  return { key: KEY, bytes, generated_at: summary.generated_at };
}
