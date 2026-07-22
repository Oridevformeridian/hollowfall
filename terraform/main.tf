# Enable necessary APIs
resource "google_project_service" "run_api" {
  service            = "run.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "artifactregistry_api" {
  service            = "artifactregistry.googleapis.com"
  disable_on_destroy = false
}

# Artifact Registry Repository to host the Docker image
resource "google_artifact_registry_repository" "repo" {
  location      = var.region
  repository_id = "${var.app_name}-repo"
  description   = "Docker repository for ${var.app_name} images"
  format        = "DOCKER"

  depends_on = [
    google_project_service.artifactregistry_api
  ]
}

# Cloud Run Service (v2)
resource "google_cloud_run_v2_service" "app" {
  name                = var.app_name
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"


  template {
    # Session affinity keeps a client pinned to an instance.
    session_affinity = true

    # The authoritative game loop is a single always-on setInterval (turn timers,
    # disconnect detection). It MUST NOT scale to zero (loop dies -> every match freezes)
    # and MUST be a single instance (avoid duplicate loops double-ticking). cpu_idle=false
    # below keeps CPU alive between requests so the loop actually runs. Pinning here makes
    # that guarantee explicit rather than an accidental leftover in the live config.
    scaling {
      min_instance_count = 1
      max_instance_count = 1
    }

    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.repo.repository_id}/${var.app_name}:${var.image_tag}"

      ports {
        container_port = 8080
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }

      resources {
        cpu_idle = false
      }
    }
  }


  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  depends_on = [
    google_project_service.run_api,
    google_artifact_registry_repository.repo
  ]
}

# Allow unauthenticated traffic (public internet access)
resource "google_cloud_run_v2_service_iam_member" "public_access" {
  location = google_cloud_run_v2_service.app.location
  name     = google_cloud_run_v2_service.app.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Custom Domain Mapping (automatically provisions SSL certificate via Let's Encrypt)
resource "google_cloud_run_domain_mapping" "custom_domain" {
  location = var.region
  name     = var.custom_domain

  metadata {
    namespace = var.project_id
  }

  spec {
    route_name = google_cloud_run_v2_service.app.name
  }
}

