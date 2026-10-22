# The Lambda image for the 15-minute job (terraform/lambda.tf).
#
# The base is pinned by digest: it fixes Node 24 and the @aws-sdk/client-s3
# the handler imports, so the image carries no unpinned code. Bump the digest
# deliberately (docker buildx imagetools inspect public.ecr.aws/lambda/nodejs:24).
# Build for linux/amd64 with --provenance=false: Lambda rejects manifest lists
# with attestations (.github/workflows/deploy.yml).
FROM public.ecr.aws/lambda/nodejs:24@sha256:92b7cccd985332238af80ac8da42d6965d418552e88955e315da4e3c0c76ca79

# package.json carries "type": "module", so .js files load as ES modules.
COPY package.json ${LAMBDA_TASK_ROOT}/
COPY src/ ${LAMBDA_TASK_ROOT}/src/
COPY lambda/ ${LAMBDA_TASK_ROOT}/lambda/

CMD ["lambda/handler.handler"]
