output "repository_url" {
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.repo.repository_id}"
  description = "The Artifact Registry Docker repository URL"
}

output "service_url" {
  value       = google_cloud_run_v2_service.app.uri
  description = "The public URL of the deployed Cloud Run service"
}
