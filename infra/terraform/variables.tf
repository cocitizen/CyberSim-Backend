variable "aws_region" {
  description = "AWS region where the CyberSim backend infrastructure is deployed."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Short project name used in Terraform-created resource names."
  type        = string
  default     = "cybersim"
}

variable "environment_name" {
  description = "Short environment name used in Terraform-created resource names. Example: terraform-test, staging, prod."
  type        = string
  default     = "terraform-test"
}

variable "vpc_id" {
  description = "Existing VPC ID where the new Elastic Beanstalk environment should be created."
  type        = string
}

variable "subnet_ids" {
  description = "Existing subnet IDs for the Elastic Beanstalk load balancer and instances."
  type        = list(string)
}

variable "rds_security_group_id" {
  description = "Existing RDS security group ID. Terraform will add an ingress rule from the new EB instance security group."
  type        = string
}

variable "api_certificate_arn" {
  description = "Existing ACM certificate ARN for the API hostname."
  type        = string
}

variable "eb_platform_arn" {
  description = "Elastic Beanstalk platform ARN for Docker on Amazon Linux 2023."
  type        = string
  default     = "arn:aws:elasticbeanstalk:us-east-1::platform/Docker running on 64bit Amazon Linux 2023/4.11.0"
}

variable "eb_instance_type" {
  description = "EC2 instance type for the Elastic Beanstalk backend instance."
  type        = string
  default     = "t3.small"
}

variable "eb_min_size" {
  description = "Minimum number of backend instances in the EB Auto Scaling Group."
  type        = number
  default     = 1
}

variable "eb_max_size" {
  description = "Maximum number of backend instances in the EB Auto Scaling Group."
  type        = number
  default     = 1
}

variable "eb_service_role_arn" {
  description = "Existing Elastic Beanstalk service role ARN."
  type        = string
}

variable "eb_instance_profile_name" {
  description = "Existing IAM instance profile name for Elastic Beanstalk EC2 instances."
  type        = string
  default     = "aws-elasticbeanstalk-ec2-role"
}

variable "db_url" {
  description = "PostgreSQL connection URL used by the backend. Treat as secret."
  type        = string
  sensitive   = true
}

variable "airtable_access_token" {
  description = "Airtable Personal Access Token used by the backend. Treat as secret."
  type        = string
  sensitive   = true
}

variable "import_password" {
  description = "Password required to run scenario imports. Treat as secret."
  type        = string
  sensitive   = true
}

variable "ui_origins" {
  description = "Frontend origins allowed to call the backend API via CORS."
  type        = list(string)
}

variable "airtable_base_ids" {
  description = "Map of scenarioSlug to Airtable base ID."
  type        = map(string)
}

variable "node_env" {
  description = "Node environment for the backend app."
  type        = string
  default     = "production"
}

variable "app_port" {
  description = "Port the Node app listens on inside the EB/Docker environment."
  type        = string
  default     = "8080"
}

variable "health_check_path" {
  description = "Elastic Beanstalk target group health check path. Use / for initial bootstrap; /health is preferred after real app deployment."
  type        = string
  default     = "/"
}