# ── Identity ──

variable "project_name" {
  description = "Names the function, its role, the ECR repo, the schedule, the alarm and the state key. Org convention: the repo name."
  type        = string
  default     = "mesonet-compliance"
}

variable "aws_region" {
  description = "AWS region."
  type        = string
  default     = "us-west-2"
}

variable "github_repo" {
  description = "GitHub repository, org/name. Scopes the OIDC trust and the Repo tag."
  type        = string
  default     = "mt-climate-office/mesonet-compliance"
}

variable "github_repository_id" {
  description = "Immutable numeric repository ID (gh api repos/mt-climate-office/mesonet-compliance --jq .id). Keeps CI authenticating across a rename."
  type        = string
}

# ── Data ──

variable "bucket_name" {
  description = "The shared, private, CDN-fronted bucket (owned by mco-aws stacks/mco-mesonet-bucket)."
  type        = string
  default     = "mco-mesonet"
}

variable "api_base" {
  description = "Mesonet API base. mesonet2 (AWS, public); the legacy mesonet. host resolves to a private IP on campus."
  type        = string
  default     = "https://mesonet2.climate.umt.edu/api/v2"
}

# ── Schedule and alarms ──

variable "schedule_expression" {
  description = "Every 15 min, off the hour (:07/:22/:37/:52), evaluated in America/Denver. /latest/ moves on the 5-min logger cycle; the reporting threshold is 120 min."
  type        = string
  default     = "cron(7,22,37,52 * * * ? *)"
}

variable "alarm_sns_topic_name" {
  description = "Org-wide ops alert topic (mco-aws stacks/account-baseline)."
  type        = string
  default     = "mco-ops-alerts"
}

variable "log_retention_days" {
  description = "CloudWatch log retention for the function. One line per run, ~96 runs a day."
  type        = number
  default     = 30
}
