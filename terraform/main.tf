# ── mesonet-compliance: the 15-minute network-health summary → data2 ──
#
# A container Lambda (mco-aws container-lambda module) invoked every 15 min by
# EventBridge Scheduler. It reads three mesonet2 API endpoints, runs the
# ruleset and overwrites one object:
#   s3://mco-mesonet/compliance/v1/summary.json
#   = https://data2.climate.umt.edu/mesonet/compliance/v1/summary.json
#
# This stack owns: the ECR repo, the function and its role, the schedule,
# the missed-run alarm and the CI role. It does NOT own the bucket (mco-aws
# stacks/mco-mesonet-bucket) or the CDN (mco-data-cdn); both serve the new
# prefix unchanged.
#
# Conventions (mco-aws/docs/conventions.md): one flat dir, tags ONLY via
# provider default_tags, no `profile` anywhere (export AWS_PROFILE=mco),
# .terraform.lock.hcl committed, terraform.tfvars not. Applies are manual and
# local (mco-aws decisions/0006): plan -out, read it, apply that plan. The
# first apply is in two stages; see README "Deploying".

terraform {
  required_version = ">= 1.10, < 2.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  backend "s3" {
    bucket       = "mco-terraform-state"
    key          = "mesonet-compliance/terraform.tfstate"
    region       = "us-west-2"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = var.project_name
      ManagedBy = "terraform"
      Repo      = var.github_repo
    }
  }
}

data "aws_caller_identity" "current" {}

data "aws_s3_bucket" "mesonet" {
  bucket = var.bucket_name # fails at plan time if the name is wrong
}

data "aws_sns_topic" "ops_alerts" {
  name = var.alarm_sns_topic_name
}

locals {
  prefix      = "compliance"
  summary_key = "${local.prefix}/v1/summary.json"

  # Built from the name, not read from the module, so the CI role does not
  # depend on the function: stage 1 of the first apply creates the role and
  # the ECR repo before any image exists (README "Deploying").
  function_arn = "arn:aws:lambda:${var.aws_region}:${data.aws_caller_identity.current.account_id}:function:${var.project_name}"
}
