output "elastic_beanstalk_application_name" {
  description = "Name of the Terraform-managed Elastic Beanstalk application."
  value       = aws_elastic_beanstalk_application.backend.name
}

output "elastic_beanstalk_environment_name" {
  description = "Name of the Terraform-managed Elastic Beanstalk environment."
  value       = aws_elastic_beanstalk_environment.backend.name
}

output "elastic_beanstalk_cname" {
  description = "Elastic Beanstalk CNAME for direct validation before DNS cutover."
  value       = aws_elastic_beanstalk_environment.backend.cname
}

output "backend_alb_security_group_id" {
  description = "Terraform-managed backend load balancer security group ID."
  value       = aws_security_group.alb.id
}

output "backend_instance_security_group_id" {
  description = "Terraform-managed backend instance security group ID."
  value       = aws_security_group.backend_instance.id
}

output "health_check_url" {
  description = "Direct EB health check URL. This is useful before any DNS cutover."
  value       = "http://${aws_elastic_beanstalk_environment.backend.cname}${var.health_check_path}"
}