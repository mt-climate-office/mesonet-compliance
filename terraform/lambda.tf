# ── The every-15-minutes function ──
#
# container-lambda rather than Fargate: the job is ~3 s and ~100 MB, and the
# org convention routes schedule-driven functions to this module
# (mco-aws docs/conventions.md, "Compute and data defaults"). No VPC: the
# function needs only the public API and S3.

module "lambda" {
  source = "git::https://github.com/mt-climate-office/mco-aws.git//modules/container-lambda?ref=v0.1.1"

  name      = var.project_name
  image_uri = "${aws_ecr_repository.this.repository_url}:latest"

  # Three fetches run in parallel, each up to 25 s with two retries
  # (src/job.js), so the worst case is about 85 s. 256 MB holds the 1.7 MB of
  # inputs several times over.
  timeout     = 120
  memory_size = 256

  # Never two runs at once, so an older run cannot overwrite a newer summary.
  reserved_concurrency = 1

  schedule_expression = var.schedule_expression
  schedule_timezone   = "America/Denver"

  log_retention_days = var.log_retention_days

  # No module Errors alarm: it pages on any single failed run, and one failed
  # API read in a 15-minute cycle loses nothing. alarms.tf pages on an hour
  # with no successful run instead.
  alarm_sns_topic_arn = null

  environment = {
    S3_BUCKET = data.aws_s3_bucket.mesonet.id
    S3_KEY    = local.summary_key
    API_BASE  = var.api_base
  }

  policy_statements = [
    {
      # The job overwrites one object. No read-back, no listing, no delete,
      # no CloudFront invalidation (Cache-Control max-age=60 does that job).
      # The bucket is SSE-S3, so no KMS grant is needed.
      sid       = "ComplianceWrite"
      actions   = ["s3:PutObject"]
      resources = ["${data.aws_s3_bucket.mesonet.arn}/${local.prefix}/*"]
    },
  ]
}

# Scheduler invokes asynchronously. Lambda's default for a failed async run is
# two retries over up to 6 h; one retry within 10 min is enough, and anything
# older is superseded by the next scheduled run.
resource "aws_lambda_function_event_invoke_config" "this" {
  function_name                = module.lambda.function_name
  maximum_retry_attempts       = 1
  maximum_event_age_in_seconds = 600
}
