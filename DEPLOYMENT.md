# Deploying Hollowfall to Google Cloud Run

This guide explains how to build the Hollowfall Docker container, push it to GCP Artifact Registry, and deploy the service to Google Cloud Run using the provided Terraform configuration.

## Prerequisites

1. **Google Cloud SDK**: Make sure the `gcloud` CLI is installed and configured on your machine.
2. **Terraform**: Install Terraform (version 1.0.0 or higher).
3. **Docker**: Ensure Docker is installed and running.
4. **Permissions**: Your GCP user/service account needs permissions to create/configure Artifact Registry, Cloud Run, and IAM bindings.

---

## Step 1: Initialize Terraform

Navigate to the `terraform` directory:
```bash
cd terraform
```

Initialize Terraform to download the required Google Cloud provider plugins:
```bash
terraform init
```

---

## Step 2: Create the Artifact Registry Repository

Before building the Docker image, we need to create the Artifact Registry repository on GCP using Terraform so we have a target repository to push to.

Run a Terraform plan and apply to create the registry repository:
```bash
terraform apply -target=google_artifact_registry_repository.repo
```
*Note: This will prompt you for your GCP Project ID (`project_id`). You can also specify it in a `terraform.tfvars` file or via the CLI.*

This creates a repository named `hollowfall-repo` in your specified region (defaulting to `us-central1`).

---

## Step 3: Build and Push the Docker Container

Get the Artifact Registry repository URL from the Terraform outputs:
```bash
terraform output repository_url
```
*(Alternatively, the format is: `<REGION>-docker.pkg.dev/<PROJECT_ID>/hollowfall-repo`)*

### 1. Authenticate Docker with GCP:
```bash
gcloud auth configure-docker <REGION>-docker.pkg.dev
```

### 2. Build the Docker image:
From the root of the project, run:
```bash
docker build -t <REGION>-docker.pkg.dev/<PROJECT_ID>/hollowfall-repo/hollowfall:latest .
```

### 3. Push the image to Artifact Registry:
```bash
docker push <REGION>-docker.pkg.dev/<PROJECT_ID>/hollowfall-repo/hollowfall:latest
```

---

## Step 4: Deploy the Cloud Run Service

Now that the image is pushed, deploy the full stack with Terraform:
```bash
cd terraform
terraform apply
```

This will deploy the Cloud Run service, set up session affinity (for Socket.io stability), and make the application publicly accessible.

Once complete, Terraform will output the `service_url` where your Hollowfall lobby is live!

---

## Custom Domain Setup (`hollowfall.roge.life`)

To route traffic to your custom domain with a managed Let's Encrypt TLS certificate:

1. **Domain Verification**: Before Terraform can map the domain, you must verify ownership of `roge.life` (or the specific subdomain `hollowfall.roge.life`) in the [Google Search Console](https://search.google.com/search-console/welcome) using the same GCP identity that runs the deployment.
2. **Apply Domain Mapping**: The Terraform configuration automatically creates the domain mapping.
3. **Configure DNS Records**: After `terraform apply` finishes, it will output `domain_resource_records`. Update your DNS registrar settings (e.g. Cloudflare, GoDaddy, etc.) with the `A` or `CNAME` records shown in the output.
4. **Wait for SSL/TLS Certificate**: Google Cloud Run will automatically provision a Let's Encrypt TLS certificate for `hollowfall.roge.life`. The SSL certificate registration takes between 5 to 15 minutes once the DNS records propagate.

