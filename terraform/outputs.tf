output "repository_url" {
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.repo.repository_id}"
  description = "The Artifact Registry Docker repository URL"
}

output "service_url" {
  value       = google_cloud_run_v2_service.app.uri
  description = "The public URL of the deployed Cloud Run service"
}

output "domain_resource_records" {
  value       = try(google_cloud_run_domain_mapping.custom_domain.status[0].resource_records, [])
  description = "DNS resource records to create for custom domain mapping"
}

