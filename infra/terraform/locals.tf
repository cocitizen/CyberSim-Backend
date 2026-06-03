locals {
  name_prefix = "${var.project_name}-${var.environment_name}"

  common_tags = {
    Project     = "CyberSim"
    Environment = var.environment_name
    ManagedBy   = "Terraform"
  }

  ui_origins_value = join(",", var.ui_origins)

  airtable_base_ids_value = join(
    ",",
    [
      for scenario_slug, base_id in var.airtable_base_ids :
      "${scenario_slug}:${base_id}"
    ]
  )
}