variable "project_id" {
  type        = string
  description = "The GCP Project ID where resources will be deployed"
}

variable "region" {
  type        = string
  default     = "us-central1"
  description = "The default GCP region to deploy resources to"
}

variable "app_name" {
  type        = string
  default     = "hollowfall"
  description = "The application name, used for naming resources"
}

variable "image_tag" {
  type        = string
  default     = "latest"
  description = "The tag of the Docker image to deploy"
}
