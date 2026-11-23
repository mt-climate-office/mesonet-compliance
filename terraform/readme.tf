# ── The product's public README: data2.climate.umt.edu/mesonet/compliance/README.md ──
#
# The provenance block (tier, built from, built by, updated, quality control,
# for analysis) and the summary's fields, for the compliance/ prefix of the
# root map (mco-aws stacks/mco-mesonet-bucket public/README.md). Same pattern
# as that root README. Static, so Terraform publishes it, not the function:
# the job still writes only v1/summary.json. Keep it in step with the summary
# fields in src/mesonet-compliance.js buildSummary().

resource "aws_s3_object" "public_readme" {
  bucket        = data.aws_s3_bucket.mesonet.id
  key           = "${local.prefix}/README.md"
  source        = "${path.module}/../public/README.md"
  etag          = filemd5("${path.module}/../public/README.md")
  content_type  = "text/markdown; charset=utf-8"
  cache_control = "public, max-age=3600"
}
