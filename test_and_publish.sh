#!/bin/bash
# Exit on any command failure
set -e

PROJECT_ID="hollowfall-game"
REGION="us-central1"
REPO_NAME="hollowfall-repo"
APP_NAME="hollowfall"

# Use git commit hash as the unique tag to force Cloud Run redeployment
IMAGE_TAG=$(git rev-parse --short HEAD)

IMAGE_URL_COMMIT="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${APP_NAME}:${IMAGE_TAG}"
IMAGE_URL_LATEST="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${APP_NAME}:latest"

echo "============================================="
echo "   Hollowfall Quality Checks                 "
echo "============================================="
echo "Running ESLint..."
npm run lint

echo "Running unit tests..."
npm run test

echo "============================================="
echo "   Building Docker Image (${IMAGE_TAG})     "
echo "============================================="
docker build -t "${IMAGE_URL_COMMIT}" -t "${IMAGE_URL_LATEST}" .

echo "============================================="
echo "   Pushing to Artifact Registry              "
echo "============================================="
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet
docker push "${IMAGE_URL_COMMIT}"
docker push "${IMAGE_URL_LATEST}"

echo "============================================="
echo "   Deploying via Terraform                   "
echo "============================================="
cd terraform
terraform apply -var="project_id=${PROJECT_ID}" -var="image_tag=${IMAGE_TAG}" -auto-approve

echo "============================================="
echo "   Hollowfall Deployed Successfully!         "
echo "============================================="
