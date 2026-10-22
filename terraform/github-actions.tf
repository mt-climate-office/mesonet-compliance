# ── The role GitHub Actions assumes (OIDC; main branch only) ──
#
# CI never writes data. It pushes the image, points the function at it, and
# invokes it once as a smoke test (deploy.yml). The run it triggers is the
# same as a scheduled one.

module "github_oidc" {
  source = "git::https://github.com/mt-climate-office/mco-aws.git//modules/github-oidc-role?ref=v0.1.1"

  project_name         = var.project_name # role: mesonet-compliance-github-actions
  github_repo          = var.github_repo
  github_repository_id = var.github_repository_id

  policy_statements = [
    {
      sid       = "ECRAuth"
      actions   = ["ecr:GetAuthorizationToken"]
      resources = ["*"]
    },
    {
      sid = "ECRPush"
      actions = [
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:BatchCheckLayerAvailability",
        "ecr:PutImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload",
      ]
      resources = [aws_ecr_repository.this.arn]
    },
    {
      sid = "LambdaDeploy"
      actions = [
        "lambda:GetFunction",
        "lambda:GetFunctionConfiguration",
        "lambda:UpdateFunctionCode",
        "lambda:InvokeFunction",
      ]
      resources = [local.function_arn]
    },
  ]
}
