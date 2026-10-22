output "github_actions_role_arn" {
  description = "Set as the repo's AWS_ROLE_ARN Actions VARIABLE (not a secret)."
  value       = module.github_oidc.role_arn
}

output "ecr_repository_url" {
  description = "CI pushes :latest and :<sha> here and points the function at :<sha>."
  value       = aws_ecr_repository.this.repository_url
}

output "function_name" {
  description = "The scheduled function."
  value       = var.project_name
}

output "log_group_name" {
  description = "Function logs."
  value       = "/aws/lambda/${var.project_name}"
}

output "summary_url" {
  description = "Where the summary is served."
  value       = "https://data2.climate.umt.edu/mesonet/${local.summary_key}"
}
