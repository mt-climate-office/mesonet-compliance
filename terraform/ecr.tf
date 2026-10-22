# ── Image repository ──
#
# The container-lambda module takes an image URI and does not create the
# repository (mesonet-alerts keeps its own ecr.tf the same way). MUTABLE
# because the function is created against :latest; deploys then point it at
# the immutable :<sha> tag (.github/workflows/deploy.yml).

resource "aws_ecr_repository" "this" {
  name                 = var.project_name
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "this" {
  repository = aws_ecr_repository.this.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the 10 most recent images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}
