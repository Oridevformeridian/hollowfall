#!/bin/bash
# Exit on any command failure
set -e

PROJECT_ID="hollowfall-game"
REGION="us-central1"
REPO_NAME="hollowfall-repo"
APP_NAME="hollowfall"
IMAGE_TAG="latest"

IMAGE_URL="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${APP_NAME}:${IMAGE_TAG}"

echo "============================================="
echo "   Hollowfall Quality Checks                 "
echo "============================================="
echo "Running ESLint..."
npm run lint

echo "Running unit tests..."
npm run test

echo "============================================="
echo "   Building Docker Image                     "
echo "============================================="
docker build -t "${IMAGE_URL}" .

echo "============================================="
echo "   Pushing to Artifact Registry              "
echo "============================================="
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet
docker push "${IMAGE_URL}"

echo "============================================="
echo "   Deploying via Terraform                   "
echo "============================================="
cd terraform
terraform apply -var="project_id=${PROJECT_ID}" -auto-approve

echo "============================================="
echo "   Hollowfall Deployed Successfully!         "
echo "============================================="
